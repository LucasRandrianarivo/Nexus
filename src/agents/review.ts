import { execSync } from 'child_process'
import { BaseAgent, AgentContext, AgentResult, Finding } from './base.js'

const SYSTEM_PROMPT = `You are a paranoid senior staff engineer doing a pre-merge code review.
Your job: find real bugs, security issues, and architectural problems. Not style issues.

For each finding, output EXACTLY this format:
[SEVERITY:confidence] TITLE
Description: ...
File: path:line (if known)
Fix: concrete fix suggestion
AutoFix: yes/no

Severity levels: CRITICAL, HIGH, MEDIUM, LOW, INFO
Confidence: 1-10 (only report >= 6)

After findings, output:
SUMMARY: one paragraph overall assessment
SCORE: X/10 (overall code quality)

Be specific. Cite line numbers. No generic advice.`

export class ReviewAgent extends BaseAgent {
  constructor() {
    super('review', 'Paranoid code review with parallel specialist dispatch')
  }

  async run(ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now()

    // Get the diff to review
    const diff = this.getDiff(ctx.projectRoot)
    if (!diff) {
      return {
        success: false,
        output: 'No changes detected. Stage your changes with git add first.',
        findings: [],
        durationMs: Date.now() - start
      }
    }

    const context = this.buildContext(ctx, ctx.task || 'code review security bugs')

    const userMessage = `${context}

## Task
${ctx.task || 'Review this diff for bugs, security issues, and architectural problems.'}

## Git Diff
\`\`\`diff
${diff.slice(0, 12000)}
\`\`\`

${diff.length > 12000 ? `[Diff truncated — ${diff.length} chars total]` : ''}

Run your review now. Be paranoid.`

    const response = await this.callClaude(SYSTEM_PROMPT, userMessage, ctx, { maxTokens: 6000 })

    const findings = this.parseFindings(response.text)

    // Filter low-confidence findings
    const filteredFindings = findings.filter(f => f.confidence >= 6)

    // Learn from this session
    ctx.memory.logSession(`Review completed: ${filteredFindings.length} findings (${filteredFindings.filter(f => f.severity === 'critical').length} critical)`, {
      agent: 'review',
      findingCount: filteredFindings.length,
      diff_size: diff.length
    })

    if (filteredFindings.some(f => f.severity === 'critical')) {
      ctx.memory.learnPattern(
        'Critical finding detected in review',
        'failure',
        ctx.task || 'code review'
      )
    }

    ctx.memory.recordMetric('review', 'code_review', true, Date.now() - start)

    return {
      success: true,
      output: response.text,
      findings: filteredFindings,
      durationMs: Date.now() - start,
      tokensUsed: response.inputTokens + response.outputTokens
    }
  }

  private getDiff(projectRoot: string): string {
    try {
      // Try staged diff first, fall back to HEAD diff
      let diff = execSync('git diff --cached', { cwd: projectRoot, encoding: 'utf-8' })
      if (!diff.trim()) {
        diff = execSync('git diff HEAD', { cwd: projectRoot, encoding: 'utf-8' })
      }
      if (!diff.trim()) {
        diff = execSync('git diff HEAD~1 HEAD', { cwd: projectRoot, encoding: 'utf-8' })
      }
      return diff
    } catch {
      return ''
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
        file: file.trim() !== 'unknown' ? file.trim() : undefined,
        fix: fix.trim(),
        autoFixable: autoFix.toLowerCase() === 'yes'
      })
    }

    return findings
  }
}
