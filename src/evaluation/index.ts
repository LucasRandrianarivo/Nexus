import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { NexusMemory } from '../memory/index.js'

export interface EvalReport {
  tests: { passed: number; failed: number; total: number; score: number }
  lint: { errors: number; warnings: number; score: number }
  coverage: { percentage: number; score: number } | null
  overall: number // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  blockers: string[]
}

export class NexusEvaluation {
  private projectRoot: string
  private memory: NexusMemory

  constructor(projectRoot: string, memory: NexusMemory) {
    this.projectRoot = projectRoot
    this.memory = memory
  }

  async run(): Promise<EvalReport> {
    const [tests, lint, coverage] = await Promise.all([
      this.runTests(),
      this.runLint(),
      this.runCoverage()
    ])

    const overall = Math.round(
      tests.score * 0.5 +
      lint.score * 0.3 +
      (coverage?.score ?? 50) * 0.2
    )

    const grade = overall >= 90 ? 'A' : overall >= 75 ? 'B' : overall >= 60 ? 'C' : overall >= 40 ? 'D' : 'F'

    const blockers: string[] = []
    if (tests.failed > 0) blockers.push(`${tests.failed} tests failing`)
    if (lint.errors > 0) blockers.push(`${lint.errors} lint errors`)
    if (coverage && coverage.percentage < 50) blockers.push(`Coverage at ${coverage.percentage}% (threshold: 50%)`)

    const report: EvalReport = { tests, lint, coverage, overall, grade, blockers }

    this.memory.logSession(`Eval: ${grade} (${overall}/100) — ${blockers.length > 0 ? blockers.join(', ') : 'no blockers'}`, {
      agent: 'eval',
      score: overall,
      grade,
      blockers
    })

    return report
  }

  private async runTests(): Promise<EvalReport['tests']> {
    const pkg = this.readPackageJson()
    if (!pkg?.scripts?.test) {
      return { passed: 0, failed: 0, total: 0, score: 50 }
    }

    try {
      const output = execSync('npm test -- --reporter=json 2>/dev/null || npx jest --json 2>/dev/null || npx vitest run --reporter=json 2>/dev/null', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 60000
      })

      // Try parse JSON output
      const lines = output.split('\n').filter(l => l.startsWith('{'))
      if (lines.length > 0) {
        const result = JSON.parse(lines[lines.length - 1])
        const passed = result.numPassedTests ?? result.passed ?? 0
        const failed = result.numFailedTests ?? result.failed ?? 0
        const total = passed + failed
        return { passed, failed, total, score: total > 0 ? Math.round((passed / total) * 100) : 50 }
      }
    } catch (e) {
      // Tests failed to run or no tests
      const errStr = String(e)
      if (errStr.includes('FAIL') || errStr.includes('failed')) {
        return { passed: 0, failed: 1, total: 1, score: 0 }
      }
    }

    return { passed: 0, failed: 0, total: 0, score: 50 }
  }

  private async runLint(): Promise<EvalReport['lint']> {
    const pkg = this.readPackageJson()
    const hasTsconfig = fs.existsSync(path.join(this.projectRoot, 'tsconfig.json'))
    const hasEslint = fs.existsSync(path.join(this.projectRoot, '.eslintrc.json')) ||
                      fs.existsSync(path.join(this.projectRoot, 'eslint.config.js')) ||
                      fs.existsSync(path.join(this.projectRoot, '.eslintrc.js'))

    if (!hasEslint && !hasTsconfig) {
      return { errors: 0, warnings: 0, score: 70 }
    }

    try {
      if (hasEslint) {
        const output = execSync('npx eslint . --format=json 2>/dev/null', {
          cwd: this.projectRoot,
          encoding: 'utf-8',
          timeout: 30000
        })
        const results = JSON.parse(output)
        const errors = results.reduce((sum: number, r: { errorCount: number }) => sum + r.errorCount, 0)
        const warnings = results.reduce((sum: number, r: { warningCount: number }) => sum + r.warningCount, 0)
        const score = Math.max(0, 100 - errors * 10 - warnings * 2)
        return { errors, warnings, score }
      }

      if (hasTsconfig) {
        execSync('npx tsc --noEmit 2>&1', { cwd: this.projectRoot, encoding: 'utf-8', timeout: 30000 })
        return { errors: 0, warnings: 0, score: 95 }
      }
    } catch (e) {
      const errStr = String(e)
      const errorCount = (errStr.match(/error TS/g) ?? []).length
      return { errors: errorCount, warnings: 0, score: Math.max(0, 100 - errorCount * 10) }
    }

    return { errors: 0, warnings: 0, score: 70 }
  }

  private async runCoverage(): Promise<EvalReport['coverage'] | null> {
    const pkg = this.readPackageJson()
    if (!pkg?.scripts?.test) return null

    try {
      const output = execSync('npx jest --coverage --coverageReporters=text-summary 2>&1 || npx vitest run --coverage 2>&1', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 90000
      })
      const match = output.match(/Statements\s*:\s*([\d.]+)%/)
      if (match) {
        const percentage = parseFloat(match[1])
        return { percentage, score: Math.min(100, Math.round(percentage * 1.2)) }
      }
    } catch { /* no coverage available */ }

    return null
  }

  private readPackageJson(): { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.projectRoot, 'package.json'), 'utf-8'))
    } catch { return null }
  }

  formatReport(report: EvalReport): string {
    const bar = (score: number) => '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10))

    let out = `\n╔══════════════════════════════════════╗\n`
    out += `║        NEXUS EVAL REPORT             ║\n`
    out += `╚══════════════════════════════════════╝\n\n`

    out += `  Tests    ${bar(report.tests.score)} ${report.tests.score}/100`
    out += report.tests.total > 0 ? `  (${report.tests.passed}/${report.tests.total} passing)\n` : '  (no tests)\n'

    out += `  Lint     ${bar(report.lint.score)} ${report.lint.score}/100`
    out += `  (${report.lint.errors} errors, ${report.lint.warnings} warnings)\n`

    if (report.coverage) {
      out += `  Coverage ${bar(report.coverage.score)} ${report.coverage.score}/100  (${report.coverage.percentage}%)\n`
    }

    out += `\n  Overall  ${bar(report.overall)} ${report.overall}/100  Grade: ${report.grade}\n`

    if (report.blockers.length > 0) {
      out += `\n  ⚠ Blockers:\n`
      for (const b of report.blockers) out += `    - ${b}\n`
    } else {
      out += `\n  ✓ No blockers — ready to ship\n`
    }

    return out
  }
}
