import { BaseAgent, AgentContext, AgentResult } from './base.js'

const SYSTEM_PROMPT = `You are a Staff Architect doing a pre-implementation technical review.
You review plans BEFORE code is written, not after.

Your job:
1. Identify ambiguities that will cause problems during implementation
2. Surface architectural decisions that need to be made NOW
3. Propose the simplest design that solves the problem
4. Identify what will break as the system scales

Output format:
## Ambiguities (resolve before coding)
- List each one with: what decision is needed, what are the options, your recommendation

## Architecture Proposal
- Component breakdown
- Data flow diagram (ASCII)
- Key interfaces/contracts
- What you're explicitly NOT building (scope boundary)

## Risk Matrix
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|

## Implementation Order
1. First: (why)
2. Then: (why)
3. Finally: (why)

## Open Questions for User
- Only questions that BLOCK implementation if unanswered

Be direct. No fluff. Assume the developer is senior.`

export class ArchitectAgent extends BaseAgent {
  constructor() {
    super('architect', 'Pre-implementation technical planning and ambiguity resolution')
  }

  async run(ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now()

    const stack = ctx.perception.detectStack()
    const structure = ctx.perception.getProjectStructure()
    const context = this.buildContext(ctx, ctx.task)

    const userMessage = `${context}

## Current Project Structure
\`\`\`
${structure}
\`\`\`

## Detected Stack
${JSON.stringify(stack, null, 2)}

## Task / Feature Request
${ctx.task}

Review this plan. Surface what needs to be decided before a single line of code is written.`

    const response = await this.callClaude(SYSTEM_PROMPT, userMessage, ctx, { maxTokens: 4000 })

    ctx.memory.logSession(`Architect review for: ${ctx.task.slice(0, 80)}`, {
      agent: 'architect',
      task: ctx.task
    })

    ctx.memory.setWorkingContext('last_arch_review', response.text)
    ctx.memory.recordMetric('architect', 'planning', true, Date.now() - start)

    return {
      success: true,
      output: response.text,
      findings: [],
      durationMs: Date.now() - start,
      tokensUsed: response.inputTokens + response.outputTokens
    }
  }
}
