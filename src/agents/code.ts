import fs from 'fs'
import path from 'path'
import { BaseAgent, AgentContext, AgentResult } from './base.js'

const SYSTEM_PROMPT = `You are a Staff Engineer implementing a feature. You write production-ready code.

Rules:
- Read the existing code patterns BEFORE writing anything new
- Match the style, naming conventions, and architecture already in place
- No placeholder comments like "// TODO implement this"
- No over-engineering — solve exactly what's asked, nothing more
- Every function you write must handle its error cases
- If you need to create a file, output it completely

Output format — for EACH file to create or modify:

FILE: relative/path/to/file.ts
ACTION: create|modify
\`\`\`language
full file content here
\`\`\`
REASON: why this file / what changed

After all files:
SUMMARY: what was implemented and what was intentionally left out
NEXT: what the developer should do next (test X, wire up Y, etc.)`

export class CodeAgent extends BaseAgent {
  constructor() {
    super('code', 'Implements features with full codebase context — production-ready, no placeholders')
  }

  async run(ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now()

    const context = this.buildContext(ctx, ctx.task)
    const stack = ctx.perception.detectStack()
    const structure = ctx.perception.getProjectStructure()

    // Get existing patterns from relevant files
    const relevantCode = ctx.perception.query(ctx.task, 8)

    const userMessage = `${context}

## Project Structure
\`\`\`
${structure}
\`\`\`

## Detected Stack
${JSON.stringify(stack, null, 2)}

## Relevant Existing Code
${relevantCode}

## Feature to Implement
${ctx.task}

Study the existing patterns carefully. Then implement the feature following the same conventions.
Output every file that needs to be created or modified — complete content, no truncation.`

    const response = await this.callClaude(SYSTEM_PROMPT, userMessage, ctx, { maxTokens: 8000 })

    // Parse and write files
    const written = this.applyFiles(response.text, ctx.projectRoot)

    ctx.memory.logSession(`Code: implemented "${ctx.task.slice(0, 60)}" — ${written.length} files written`, {
      agent: 'code',
      task: ctx.task,
      files: written
    })

    ctx.memory.learnPattern(
      `Implemented: ${ctx.task.slice(0, 80)}`,
      'success',
      `Files: ${written.join(', ')}`
    )

    ctx.memory.recordMetric('code', 'implement', written.length > 0, Date.now() - start)

    return {
      success: written.length > 0,
      output: response.text,
      findings: [],
      durationMs: Date.now() - start,
      tokensUsed: response.inputTokens + response.outputTokens
    }
  }

  private applyFiles(output: string, projectRoot: string): string[] {
    const written: string[] = []
    // Match FILE: path\nACTION: create|modify\n```lang\ncontent\n```
    const filePattern = /FILE:\s*(.+?)\nACTION:\s*(create|modify)\n```(?:\w+)?\n([\s\S]+?)```/gi

    for (const match of output.matchAll(filePattern)) {
      const [, filePath, , content] = match
      const fullPath = path.join(projectRoot, filePath.trim())

      try {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, content, 'utf-8')
        written.push(filePath.trim())
      } catch (e) {
        // Skip unwritable paths
      }
    }

    return written
  }
}
