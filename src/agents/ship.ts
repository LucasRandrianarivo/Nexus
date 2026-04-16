import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { BaseAgent, AgentContext, AgentResult } from './base.js'

const CHANGELOG_PROMPT = `You are a release engineer writing a changelog entry.

Given a git diff and commit history, write:
1. A semantic version bump recommendation (patch/minor/major) with reason
2. A clean changelog entry in Keep a Changelog format

Output EXACTLY:
VERSION_BUMP: patch|minor|major
REASON: one sentence why

CHANGELOG:
## [version] - date

### Added
- ...

### Fixed
- ...

### Changed
- ...

### Security
- ...

Only include sections that have changes. Be concise. User-facing language only.`

export class ShipAgent extends BaseAgent {
  constructor() {
    super('ship', 'Full automated ship: eval → commit → changelog → PR')
  }

  async run(ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now()
    const log: string[] = []

    const step = (msg: string) => {
      log.push(msg)
      ctx.onToken?.(`\n${msg}`)
    }

    // ── Step 1: Pre-flight checks ────────────────────────────────────────────
    step('── [1/5] Pre-flight checks')

    const isGitRepo = this.exec('git rev-parse --git-dir', ctx.projectRoot)
    if (!isGitRepo.success) {
      return { success: false, output: 'Not a git repository.', findings: [], durationMs: Date.now() - start }
    }

    const status = this.exec('git status --porcelain', ctx.projectRoot)
    const hasChanges = (status.output?.trim().length ?? 0) > 0
    if (!hasChanges) {
      return { success: false, output: 'Nothing to ship — working tree is clean.', findings: [], durationMs: Date.now() - start }
    }

    step(`  ✓ ${status.output?.split('\n').filter(Boolean).length} files changed`)

    // ── Step 2: Run tests ────────────────────────────────────────────────────
    step('── [2/5] Running tests')
    const tests = this.exec('npm test 2>&1 || true', ctx.projectRoot, 60000)
    const testsPassed = !tests.output?.includes('FAIL') && !tests.output?.includes('failed')
    step(testsPassed ? '  ✓ Tests passing' : '  ⚠ Tests failing — shipping anyway (fix with `nexus fix`)')

    // ── Step 3: Generate commit message ─────────────────────────────────────
    step('── [3/5] Generating commit message')

    const diff = this.exec('git diff HEAD', ctx.projectRoot).output ?? ''
    const gitLog = this.exec('git log --oneline -10', ctx.projectRoot).output ?? ''

    const commitResponse = await this.callClaude(
      `You generate git commit messages. Output ONLY the commit message, nothing else.
Follow Conventional Commits: feat/fix/refactor/docs/chore/test/perf(scope): description
First line max 72 chars. Optional body after blank line for context.`,
      `Git diff:\n${diff.slice(0, 6000)}\n\nRecent history:\n${gitLog}\n\nTask context: ${ctx.task || 'ship changes'}`,
      ctx,
      { fast: true, maxTokens: 256 }
    )

    const commitMsg = commitResponse.text.trim()
    step(`  ✓ "${commitMsg.split('\n')[0]}"`)

    // ── Step 4: Commit ───────────────────────────────────────────────────────
    step('── [4/5] Committing')
    this.exec('git add -A', ctx.projectRoot)
    const commit = this.exec(`git commit -m ${JSON.stringify(commitMsg)}`, ctx.projectRoot)

    if (!commit.success) {
      return { success: false, output: `Commit failed:\n${commit.output}`, findings: [], durationMs: Date.now() - start }
    }
    step('  ✓ Committed')

    // Update changelog
    const changelogPath = path.join(ctx.projectRoot, 'CHANGELOG.md')
    const changelogResponse = await this.callClaude(
      CHANGELOG_PROMPT,
      `Diff:\n${diff.slice(0, 5000)}\n\nHistory:\n${gitLog}`,
      ctx,
      { fast: true, maxTokens: 512 }
    )
    this.updateChangelog(changelogPath, changelogResponse.text)
    step('  ✓ CHANGELOG.md updated')

    // ── Step 5: Push + PR ────────────────────────────────────────────────────
    step('── [5/5] Pushing')
    const push = this.exec('git push 2>&1', ctx.projectRoot)

    if (!push.success) {
      const pushWithUpstream = this.exec('git push --set-upstream origin HEAD 2>&1', ctx.projectRoot)
      if (!pushWithUpstream.success) {
        step(`  ⚠ Push failed: ${push.output?.slice(0, 100)}`)
      } else {
        step('  ✓ Pushed (new branch)')
      }
    } else {
      step('  ✓ Pushed')
    }

    // Try creating PR via gh cli
    const ghAvailable = this.exec('which gh', ctx.projectRoot).success
    if (ghAvailable) {
      const prTitle = commitMsg.split('\n')[0]
      const pr = this.exec(
        `gh pr create --title ${JSON.stringify(prTitle)} --body ${JSON.stringify(`## Changes\n\n${commitMsg}\n\n🤖 Shipped via NEXUS`)} --fill 2>&1`,
        ctx.projectRoot
      )
      if (pr.success && pr.output) {
        step(`  ✓ PR created: ${pr.output.trim()}`)
      }
    }

    ctx.memory.logSession(`Shipped: "${commitMsg.split('\n')[0]}"`, { agent: 'ship', commit: commitMsg })
    ctx.memory.recordMetric('ship', 'ship', true, Date.now() - start)

    return {
      success: true,
      output: log.join('\n'),
      findings: [],
      durationMs: Date.now() - start,
      tokensUsed: commitResponse.inputTokens + commitResponse.outputTokens
    }
  }

  private exec(cmd: string, cwd: string, timeout = 15000): { success: boolean; output?: string } {
    try {
      const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout })
      return { success: true, output }
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      return { success: false, output: err.stdout ?? err.stderr ?? err.message ?? '' }
    }
  }

  private updateChangelog(changelogPath: string, content: string) {
    const match = content.match(/CHANGELOG:\n([\s\S]+)/)
    if (!match) return

    const entry = match[1].trim()
    const existing = fs.existsSync(changelogPath)
      ? fs.readFileSync(changelogPath, 'utf-8')
      : '# Changelog\n\nAll notable changes to this project will be documented in this file.\n'

    const updated = existing.replace(
      '# Changelog\n',
      `# Changelog\n\n${entry}\n`
    )

    fs.writeFileSync(changelogPath, updated, 'utf-8')
  }
}
