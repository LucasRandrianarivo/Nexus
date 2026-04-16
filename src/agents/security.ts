import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { BaseAgent, AgentContext, AgentResult, Finding } from './base.js'

const SYSTEM_PROMPT = `You are a Chief Security Officer running a 360° attack surface scan.

Scan phases you MUST cover:
1. Secrets & credentials (hardcoded keys, tokens, passwords in code/git history)
2. Injection vulnerabilities (SQL, shell, XSS, SSTI)
3. Authentication & authorization flaws
4. Dependency supply chain (known CVEs, abandoned packages, suspicious install scripts)
5. Data exposure (PII leaks, verbose errors, insecure logging)
6. LLM-specific risks (prompt injection, unsanitized LLM output used in dangerous operations)
7. Infrastructure misconfigs (open ports, permissive CORS, missing security headers)
8. STRIDE threat model (Spoofing, Tampering, Repudiation, Info disclosure, DoS, Elevation)

For each finding, output EXACTLY:
[SEVERITY:confidence] TITLE
Description: ...
File: path:line (or "architecture" for design issues)
Fix: concrete mitigation
AutoFix: yes/no
ExploitScenario: brief realistic attack scenario

Confidence >= 7 only. No false positives. Verify before reporting.

End with:
RISK_SUMMARY: overall risk rating (CRITICAL/HIGH/MEDIUM/LOW) and top 3 priorities`

export class SecurityAgent extends BaseAgent {
  constructor() {
    super('security', '14-phase attack surface scanner with STRIDE threat modeling')
  }

  async run(ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now()

    const scanData = this.gatherScanData(ctx.projectRoot)
    const context = this.buildContext(ctx, 'security vulnerabilities authentication authorization')

    const userMessage = `${context}

## Security Scan Data

### File Structure
\`\`\`
${ctx.perception.getProjectStructure()}
\`\`\`

### Git History (recent)
\`\`\`
${scanData.gitLog}
\`\`\`

### Environment Files Found
${scanData.envFiles.length > 0 ? scanData.envFiles.join('\n') : 'None found'}

### package.json Dependencies
\`\`\`json
${scanData.packageJson}
\`\`\`

### Sample Code (high-risk files)
${scanData.highRiskCode}

## Task
${ctx.task || 'Run a comprehensive security scan. Find real vulnerabilities.'}

Run all 8 scan phases now.`

    const response = await this.callClaude(SYSTEM_PROMPT, userMessage, ctx, { maxTokens: 8000 })
    const findings = this.parseFindings(response.text)

    ctx.memory.logSession(`Security scan: ${findings.length} findings`, {
      agent: 'security',
      criticalCount: findings.filter(f => f.severity === 'critical').length
    })

    ctx.memory.recordMetric('security', 'security_scan', true, Date.now() - start)

    return {
      success: true,
      output: response.text,
      findings,
      durationMs: Date.now() - start,
      tokensUsed: response.inputTokens + response.outputTokens
    }
  }

  private gatherScanData(projectRoot: string) {
    let gitLog = ''
    try {
      gitLog = execSync('git log --oneline -20', { cwd: projectRoot, encoding: 'utf-8' })
    } catch { gitLog = 'Not a git repo or no commits' }

    // Find .env files (list them, don't read content for security)
    const envFiles: string[] = []
    for (const f of ['.env', '.env.local', '.env.production', '.env.staging']) {
      if (fs.existsSync(path.join(projectRoot, f))) {
        envFiles.push(`${f} (EXISTS — check for hardcoded secrets)`)
      }
    }

    let packageJson = '{}'
    try {
      const pkg = fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')
      const parsed = JSON.parse(pkg)
      packageJson = JSON.stringify({
        dependencies: parsed.dependencies ?? {},
        devDependencies: parsed.devDependencies ?? {},
        scripts: parsed.scripts ?? {}
      }, null, 2).slice(0, 3000)
    } catch { /* no package.json */ }

    // Find high-risk files (auth, api routes, db)
    const highRiskPatterns = ['auth', 'login', 'password', 'token', 'api', 'route', 'db', 'database', 'query', 'sql']
    const highRiskCode = this.readHighRiskFiles(projectRoot, highRiskPatterns)

    return { gitLog, envFiles, packageJson, highRiskCode }
  }

  private readHighRiskFiles(root: string, patterns: string[]): string {
    const results: string[] = []
    const maxFiles = 5

    const walk = (dir: string, depth = 0) => {
      if (depth > 4 || results.length >= maxFiles) return
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (['node_modules', '.git', 'dist'].includes(entry.name)) continue
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            walk(fullPath, depth + 1)
          } else if (patterns.some(p => entry.name.toLowerCase().includes(p))) {
            try {
              const content = fs.readFileSync(fullPath, 'utf-8').slice(0, 2000)
              results.push(`### ${fullPath.replace(root, '')}\n\`\`\`\n${content}\n\`\`\``)
            } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }
    }

    walk(root)
    return results.join('\n\n') || 'No high-risk files found'
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

    return findings.filter(f => f.confidence >= 7)
  }
}
