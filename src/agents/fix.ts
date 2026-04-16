import fs from 'fs'
import path from 'path'
import { BaseAgent, AgentContext, AgentResult, Finding } from './base.js'

const SYSTEM_PROMPT = `You are fixing bugs and security issues found during a code review.

For each finding you receive:
1. Locate the exact code to fix
2. Apply the minimal fix — don't refactor surrounding code
3. Verify the fix doesn't break anything adjacent

Output format for EACH fix:

FIX: [SEVERITY] Finding title
FILE: relative/path/to/file.ts
LINE: approximate line number
BEFORE:
\`\`\`language
exact original code snippet (5-10 lines max)
\`\`\`
AFTER:
\`\`\`language
fixed code snippet
\`\`\`
CONFIDENCE: 1-10 (how sure are you this fix is correct and safe)
SKIP_REASON: (only if you're skipping this fix — explain why)

After all fixes:
APPLIED: list of fixes applied
SKIPPED: list of fixes skipped with reasons
WARNING: anything the developer must verify manually`

export class FixAgent extends BaseAgent {
  constructor() {
    super('fix', 'Auto-fixes findings from review — minimal, surgical, no collateral damage')
  }

  async run(ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now()

    // Load findings from working memory or task
    const lastReview = ctx.memory.getWorkingContext('last_review_findings')
    const findingsText = lastReview ?? ctx.task

    if (!findingsText || findingsText.trim() === 'fix') {
      return {
        success: false,
        output: 'No findings to fix. Run `nexus review` first, then `nexus fix`.',
        findings: [],
        durationMs: Date.now() - start
      }
    }

    const context = this.buildContext(ctx, 'bug fix security vulnerability')

    const userMessage = `${context}

## Findings to Fix
${findingsText}

## Project Structure
\`\`\`
${ctx.perception.getProjectStructure()}
\`\`\`

Fix each finding. Be surgical — touch only what's needed.
Skip any fix where confidence < 7 or where the fix could cause regressions.`

    const response = await this.callClaude(SYSTEM_PROMPT, userMessage, ctx, { maxTokens: 8000 })

    const applied = this.applyFixes(response.text, ctx.projectRoot)

    ctx.memory.logSession(`Fix: applied ${applied} fixes`, { agent: 'fix', applied })
    ctx.memory.recordMetric('fix', 'auto_fix', applied > 0, Date.now() - start)

    return {
      success: true,
      output: response.text,
      findings: [],
      durationMs: Date.now() - start,
      tokensUsed: response.inputTokens + response.outputTokens
    }
  }

  private applyFixes(output: string, projectRoot: string): number {
    let applied = 0
    const fixPattern = /FILE:\s*(.+?)\n[\s\S]*?BEFORE:\n```(?:\w+)?\n([\s\S]+?)```\nAFTER:\n```(?:\w+)?\n([\s\S]+?)```\nCONFIDENCE:\s*(\d+)/gi

    for (const match of output.matchAll(fixPattern)) {
      const [, filePath, before, after, confidenceStr] = match
      const confidence = parseInt(confidenceStr)

      if (confidence < 7) continue // only apply high-confidence fixes

      const fullPath = path.join(projectRoot, filePath.trim())
      if (!fs.existsSync(fullPath)) continue

      try {
        const content = fs.readFileSync(fullPath, 'utf-8')
        const fixed = content.replace(before.trim(), after.trim())
        if (fixed !== content) {
          fs.writeFileSync(fullPath, fixed, 'utf-8')
          applied++
        }
      } catch { /* skip unwritable files */ }
    }

    return applied
  }
}
