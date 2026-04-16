import Anthropic from '@anthropic-ai/sdk'
import { NexusMemory } from '../memory/index.js'
import { NexusPerception } from '../perception/index.js'

export interface AgentContext {
  projectRoot: string
  task: string
  memory: NexusMemory
  perception: NexusPerception
  model?: string
  onToken?: (token: string) => void
}

export interface AgentResult {
  success: boolean
  output: string
  findings: Finding[]
  durationMs: number
  tokensUsed?: number
}

export interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  confidence: number // 1-10
  title: string
  description: string
  file?: string
  line?: number
  fix?: string
  autoFixable: boolean
}

export abstract class BaseAgent {
  protected client: Anthropic
  protected name: string
  protected description: string

  constructor(name: string, description: string) {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })
    this.name = name
    this.description = description
  }

  abstract run(ctx: AgentContext): Promise<AgentResult>

  protected async callClaude(
    systemPrompt: string,
    userMessage: string,
    ctx: AgentContext,
    opts: { fast?: boolean; maxTokens?: number } = {}
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const model = opts.fast
      ? (process.env.NEXUS_FAST_MODEL ?? 'claude-haiku-4-5-20251001')
      : (ctx.model ?? process.env.NEXUS_MODEL ?? 'claude-sonnet-4-6')

    const stream = await this.client.messages.stream({
      model,
      max_tokens: opts.maxTokens ?? 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    })

    let text = ''
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        text += chunk.delta.text
        ctx.onToken?.(chunk.delta.text)
      }
    }

    const finalMsg = await stream.finalMessage()
    return {
      text,
      inputTokens: finalMsg.usage.input_tokens,
      outputTokens: finalMsg.usage.output_tokens
    }
  }

  protected buildContext(ctx: AgentContext, question: string): string {
    const stack = ctx.perception.detectStack()
    const relevantCode = ctx.perception.query(question)
    const recentHistory = ctx.memory.search(question, 'episodic', 3)
    const patterns = ctx.memory.search(question, 'procedural', 3)

    let context = `## Project Context\n`
    context += `Root: ${ctx.projectRoot}\n`
    context += `Stack: ${JSON.stringify(stack)}\n\n`

    if (relevantCode && relevantCode !== 'No relevant code found in index.') {
      context += `## Relevant Code\n${relevantCode}\n\n`
    }

    if (recentHistory.length > 0) {
      context += `## Recent History\n`
      context += recentHistory.map(r => r.content).join('\n---\n') + '\n\n'
    }

    if (patterns.length > 0) {
      context += `## Known Patterns\n`
      context += patterns.map(r => r.content).join('\n---\n') + '\n\n'
    }

    return context
  }

  getName(): string { return this.name }
  getDescription(): string { return this.description }
}
