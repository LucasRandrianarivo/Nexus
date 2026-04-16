import { BaseAgent, AgentContext, AgentResult } from './base.js'
import { BrowserClient } from '../browser/client.js'

const SYSTEM_PROMPT = `You are a QA engineer controlling a real browser via commands.

Available commands (output them one per line, I will execute them and return results):
- NAVIGATE url              → go to URL
- SNAPSHOT                  → get accessibility tree with refs (@e1, @e2, ...)
- CLICK @eN                 → click element by ref
- TYPE @eN "text"           → fill input with text
- PRESS @eN Enter           → press key on element
- SCROLL down|up            → scroll the page
- SCREENSHOT                → capture screenshot (returns file path)
- BACK                      → browser back
- FORWARD                   → browser forward
- EVAL "js expression"      → evaluate JavaScript, returns result
- DONE "summary"            → task complete, explain what was done

Rules:
- Always SNAPSHOT after navigating to see what's on the page
- Use refs from the last SNAPSHOT only (they reset on navigation)
- Before clicking a form submit, SCREENSHOT to verify the form is filled
- If a ref fails, SNAPSHOT again — the page may have changed
- When the task is complete, output DONE with a summary

Output ONLY commands, one per line. No prose between commands.`

export class BrowseAgent extends BaseAgent {
  private browserClient: BrowserClient

  constructor() {
    super('browse', 'Real browser automation via persistent Chromium daemon — ref-based, 100ms/cmd')
    this.browserClient = new BrowserClient()
  }

  async run(ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now()
    const log: string[] = []

    // Ensure daemon is running
    if (!this.browserClient.isDaemonRunning()) {
      ctx.onToken?.('\nStarting browser daemon...')
      await this.browserClient.startDaemon()
      ctx.onToken?.(' ready\n')
    }

    // Agentic loop: Claude outputs commands, we execute, feed results back
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    let iteration = 0
    const MAX_ITERATIONS = 20

    const initialPrompt = `Task: ${ctx.task}\n\nStart by navigating to the right URL or taking a snapshot if you're already on the right page.`
    messages.push({ role: 'user', content: initialPrompt })

    while (iteration < MAX_ITERATIONS) {
      iteration++

      // Ask Claude for next commands
      const response = await this.client.messages.create({
        model: ctx.model ?? process.env.NEXUS_MODEL ?? 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages
      })

      const assistantText = response.content[0].type === 'text' ? response.content[0].text : ''
      messages.push({ role: 'assistant', content: assistantText })

      ctx.onToken?.('\n' + assistantText)
      log.push(assistantText)

      // Check for DONE
      const doneMatch = assistantText.match(/^DONE\s+"(.+)"$/m)
      if (doneMatch) {
        const summary = doneMatch[1]
        ctx.memory.logSession(`Browse: ${summary}`, { agent: 'browse', task: ctx.task, iterations: iteration })
        ctx.memory.recordMetric('browse', 'browser_task', true, Date.now() - start)
        return {
          success: true,
          output: log.join('\n'),
          findings: [],
          durationMs: Date.now() - start
        }
      }

      // Execute commands
      const results = await this.executeCommands(assistantText, ctx)
      const resultsText = results.join('\n')
      ctx.onToken?.('\n' + resultsText)
      messages.push({ role: 'user', content: `Results:\n${resultsText}` })
    }

    return {
      success: false,
      output: `Max iterations (${MAX_ITERATIONS}) reached.\n` + log.join('\n'),
      findings: [],
      durationMs: Date.now() - start
    }
  }

  private async executeCommands(text: string, ctx: AgentContext): Promise<string[]> {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    const results: string[] = []

    for (const line of lines) {
      if (line.startsWith('DONE')) break

      try {
        const result = await this.executeCommand(line)
        results.push(`✓ ${line} → ${JSON.stringify(result.data ?? result.error).slice(0, 200)}`)
      } catch (e) {
        results.push(`✗ ${line} → Error: ${String(e).slice(0, 100)}`)
      }
    }

    return results
  }

  private async executeCommand(line: string) {
    // NAVIGATE url
    if (line.startsWith('NAVIGATE ')) {
      return this.browserClient.navigate(line.slice(9).trim())
    }

    // SNAPSHOT
    if (line === 'SNAPSHOT') {
      return this.browserClient.snapshot()
    }

    // CLICK @eN
    if (line.startsWith('CLICK ')) {
      return this.browserClient.click(line.slice(6).trim())
    }

    // TYPE @eN "text"
    if (line.startsWith('TYPE ')) {
      const match = line.match(/^TYPE\s+(@\w+)\s+"(.+)"$/)
      if (!match) throw new Error('Invalid TYPE syntax. Use: TYPE @eN "text"')
      return this.browserClient.type(match[1], match[2])
    }

    // PRESS @eN Key
    if (line.startsWith('PRESS ')) {
      const parts = line.slice(6).trim().split(/\s+/)
      return this.browserClient.press(parts[0], parts.slice(1).join('+'))
    }

    // SCROLL down|up
    if (line.startsWith('SCROLL ')) {
      const dir = line.slice(7).trim() as 'up' | 'down'
      return this.browserClient.scroll(dir)
    }

    // SCREENSHOT
    if (line === 'SCREENSHOT') {
      return this.browserClient.screenshot()
    }

    // BACK / FORWARD
    if (line === 'BACK') return this.browserClient.back()
    if (line === 'FORWARD') return this.browserClient.forward()

    // EVAL "js"
    if (line.startsWith('EVAL ')) {
      const match = line.match(/^EVAL\s+"(.+)"$/)
      if (!match) throw new Error('Invalid EVAL syntax. Use: EVAL "expression"')
      return this.browserClient.evaluate(match[1])
    }

    throw new Error(`Unknown command: ${line}`)
  }
}
