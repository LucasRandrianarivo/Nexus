import { execSync } from 'child_process'
import { BaseAgent, AgentContext, AgentResult, Finding } from './base.js'

const SYSTEM_PROMPT = `You are a QA Engineer. Your job is to find what's broken BEFORE it reaches production.

Your approach:
1. Analyze the code changes (diff or codebase)
2. Identify what use cases are NOT covered by existing tests
3. Generate concrete test cases for each gap
4. Identify edge cases that will cause runtime failures (null, empty, overflow, concurrency)
5. Check that error handling is correct and doesn't swallow exceptions silently

Output format:

## Test Coverage Gaps
For each gap:
- USE_CASE: what scenario is untested
- RISK: what breaks if this is not tested
- TEST: concrete test pseudo-code

## Edge Cases Found
- EDGE_CASE: the scenario
- WILL_BREAK: what happens without handling
- FIX: how to handle it

## Findings
[SEVERITY:confidence] TITLE
Description: ...
File: path:line
Fix: ...
AutoFix: yes/no

## Test Plan
Ordered list of what to test first, with rationale.

Be specific. Real file paths, real function names. No generic advice.`

export class QAAgent extends BaseAgent {
  constructor() {
    super('qa', 'Test coverage analysis, edge case detection, test generation')
  }

  async run(ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now()

    const testResults = this.runExistingTests(ctx.projectRoot)
    const context = this.buildContext(ctx, ctx.task || 'test coverage edge cases bugs')

    const userMessage = `${context}

## Existing Test Results
\`\`\`
${testResults}
\`\`\`

## Project Structure
\`\`\`
${ctx.perception.getProjectStructure()}
\`\`\`

## Task
${ctx.task || 'Analyze test coverage, find edge cases, generate a test plan.'}

Find what will break in production that tests don't currently catch.`

    const response = await this.callClaude(SYSTEM_PROMPT, userMessage, ctx, { maxTokens: 5000 })
    const findings = this.parseFindings(response.text)

    ctx.memory.logSession(`QA analysis: ${findings.length} findings`, { agent: 'qa' })
    ctx.memory.recordMetric('qa', 'test_analysis', true, Date.now() - start)

    return {
      success: true,
      output: response.text,
      findings,
      durationMs: Date.now() - start,
      tokensUsed: response.inputTokens + response.outputTokens
    }
  }

  private runExistingTests(projectRoot: string): string {
    try {
      const output = execSync('npm test 2>&1', {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 60000
      })
      return output.slice(0, 3000)
    } catch (e) {
      return `Tests failed or not configured:\n${String(e).slice(0, 1000)}`
    }
  }

  private parseFindings(text: string): Finding[] {
    const findings: Finding[] = []
    const pattern = /\[(CRITICAL|HIGH|MEDIUM|LOW|INFO):(\d+)\]\s+(.+?)\nDescription:\s*(.+?)\nFile:\s*(.+?)\nFix:\s*(.+?)\nAutoFix:\s*(yes|no)/gis
    for (const match of text.matchAll(pattern)) {
      const [, severity, confidence, title, description, file, fix, autoFix] = match
      findings.push({
        severity: severity.toLowerCase() as Finding['severity'],
        confidence: parseInt(confidence),
        title: title.trim(),
        description: description.trim(),
        file: file.trim(),
        fix: fix.trim(),
        autoFixable: autoFix.toLowerCase() === 'yes'
      })
    }
    return findings.filter(f => f.confidence >= 5)
  }
}
