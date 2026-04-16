#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import path from 'path'
import fs from 'fs'
import { config } from 'dotenv'
import { NexusMemory } from '../memory/index.js'
import { NexusPerception } from '../perception/index.js'
import { NexusOrchestrator } from '../orchestrator/index.js'
import { NexusEvaluation } from '../evaluation/index.js'

// Load .env from project root or cwd
config({ path: path.join(process.cwd(), '.env') })
config({ path: path.join(process.env.HOME ?? '~', '.nexus', '.env') })

const program = new Command()

program
  .name('nexus')
  .description(chalk.bold('NEXUS — Stateful multi-agent engineering OS'))
  .version('0.1.0')

// ─── /review ────────────────────────────────────────────────────────────────
program
  .command('review [task]')
  .alias('r')
  .description('Paranoid code review — finds real bugs, not style issues')
  .option('-p, --project <path>', 'Project root', process.cwd())
  .option('--no-index', 'Skip codebase indexing')
  .action(async (task, opts) => {
    await runAgent('review', task || 'Review staged changes for bugs and security issues', opts)
  })

// ─── /security ──────────────────────────────────────────────────────────────
program
  .command('security [task]')
  .alias('cso')
  .description('360° attack surface scan — OWASP, STRIDE, secrets, supply chain')
  .option('-p, --project <path>', 'Project root', process.cwd())
  .action(async (task, opts) => {
    await runAgent('security', task || 'Run a comprehensive security scan', opts)
  })

// ─── /architect ─────────────────────────────────────────────────────────────
program
  .command('architect <task>')
  .alias('plan')
  .description('Pre-implementation review — surfaces ambiguities before you code')
  .option('-p, --project <path>', 'Project root', process.cwd())
  .action(async (task, opts) => {
    await runAgent('architect', task, opts)
  })

// ─── /code ──────────────────────────────────────────────────────────────────
program
  .command('code <task>')
  .description('Implement a feature — reads codebase patterns, writes production-ready code')
  .option('-p, --project <path>', 'Project root', process.cwd())
  .action(async (task, opts) => {
    await runAgent('code', task, opts)
  })

// ─── /fix ───────────────────────────────────────────────────────────────────
program
  .command('fix [task]')
  .description('Auto-fix findings from last review — surgical, no collateral damage')
  .option('-p, --project <path>', 'Project root', process.cwd())
  .action(async (task, opts) => {
    await runAgent('fix', task || 'fix', opts)
  })

// ─── /ship ──────────────────────────────────────────────────────────────────
program
  .command('ship [task]')
  .description('Full ship: eval → commit → changelog → push → PR')
  .option('-p, --project <path>', 'Project root', process.cwd())
  .action(async (task, opts) => {
    await runAgent('ship', task || 'ship current changes', opts)
  })

// ─── /browse ────────────────────────────────────────────────────────────────
program
  .command('browse <task>')
  .description('Browser automation — persistent Chromium daemon, ref-based, 100ms/cmd')
  .option('-p, --project <path>', 'Project root', process.cwd())
  .action(async (task, opts) => {
    await runAgent('browse', task, opts)
  })

// ─── /browser ────────────────────────────────────────────────────────────────
program
  .command('browser <action>')
  .description('Manage browser daemon — start | stop | status')
  .action(async (action) => {
    const { BrowserClient } = await import('../browser/client.js')
    const client = new BrowserClient()

    if (action === 'start') {
      if (client.isDaemonRunning()) {
        console.log(chalk.green('Browser daemon already running'))
        return
      }
      const spinner = ora('Starting Chromium daemon...').start()
      await client.startDaemon()
      spinner.succeed(chalk.green('Browser daemon started'))

    } else if (action === 'stop') {
      await client.stopDaemon()
      console.log(chalk.green('Browser daemon stopped'))

    } else if (action === 'status') {
      const running = client.isDaemonRunning()
      console.log(running
        ? chalk.green('Browser daemon: running')
        : chalk.dim('Browser daemon: stopped'))
    } else {
      console.log(chalk.red(`Unknown action: ${action}. Use start | stop | status`))
    }
  })

// ─── /ask ───────────────────────────────────────────────────────────────────
program
  .command('ask <task>')
  .description('Smart routing — nexus picks the right agent(s) for your task')
  .option('-p, --project <path>', 'Project root', process.cwd())
  .action(async (task, opts) => {
    await runAgent(undefined, task, opts)
  })

// ─── /eval ──────────────────────────────────────────────────────────────────
program
  .command('eval')
  .description('Objective evaluation — tests, lint, coverage (no LLM bias)')
  .option('-p, --project <path>', 'Project root', process.cwd())
  .action(async (opts) => {
    const projectRoot = path.resolve(opts.project)
    const projectName = path.basename(projectRoot)

    printHeader('EVAL', projectName)

    const memory = new NexusMemory(projectName)
    const spinner = ora('Running tests, lint, coverage...').start()

    const evaluator = new NexusEvaluation(projectRoot, memory)
    const report = await evaluator.run()

    spinner.stop()
    console.log(evaluator.formatReport(report))
  })

// ─── /index ─────────────────────────────────────────────────────────────────
program
  .command('index')
  .description('Index the codebase into semantic memory')
  .option('-p, --project <path>', 'Project root', process.cwd())
  .action(async (opts) => {
    const projectRoot = path.resolve(opts.project)
    const projectName = path.basename(projectRoot)

    printHeader('INDEX', projectName)

    const memory = new NexusMemory(projectName)
    const perception = new NexusPerception(projectRoot, memory)

    const spinner = ora('Indexing codebase...').start()
    let count = 0
    const indexed = await perception.indexProject((file) => {
      count++
      spinner.text = `Indexing... ${count} files (${file})`
    })
    spinner.succeed(chalk.green(`Indexed ${indexed} files into semantic memory`))

    const stack = perception.detectStack()
    console.log('\n' + chalk.dim('Detected stack:'), chalk.cyan(JSON.stringify(stack)))
  })

// ─── /memory ────────────────────────────────────────────────────────────────
program
  .command('memory [query]')
  .alias('mem')
  .description('Search project memory')
  .option('-p, --project <path>', 'Project root', process.cwd())
  .option('-t, --type <type>', 'Memory type: episodic|semantic|procedural|working')
  .action(async (query, opts) => {
    const projectRoot = path.resolve(opts.project)
    const projectName = path.basename(projectRoot)

    const memory = new NexusMemory(projectName)
    const results = memory.search(
      query || 'recent',
      opts.type as 'episodic' | 'semantic' | 'procedural' | 'working' | undefined,
      20
    )

    if (results.length === 0) {
      console.log(chalk.dim('No memories found. Run `nexus index` first.'))
      return
    }

    console.log(chalk.bold(`\n${results.length} memories found:\n`))
    for (const r of results) {
      const badge = typeBadge(r.type)
      console.log(`${badge} ${chalk.dim(`relevance: ${r.relevance.toFixed(2)}`)}`)
      console.log(chalk.white(r.content.slice(0, 200)) + (r.content.length > 200 ? chalk.dim('...') : ''))
      console.log()
    }
  })

// ─── /agents ────────────────────────────────────────────────────────────────
program
  .command('agents')
  .description('List all available agents and their success rates')
  .option('-p, --project <path>', 'Project root', process.cwd())
  .action(async (opts) => {
    const projectRoot = path.resolve(opts.project)
    const projectName = path.basename(projectRoot)
    const memory = new NexusMemory(projectName)
    const perception = new NexusPerception(projectRoot, memory)
    const orchestrator = new NexusOrchestrator({ projectRoot, memory, perception })

    const agents = orchestrator.listAgents()
    console.log(chalk.bold('\nNEXUS Agents:\n'))
    for (const a of agents) {
      const rate = Math.round(a.successRate * 100)
      const rateColor = rate >= 80 ? chalk.green : rate >= 60 ? chalk.yellow : chalk.red
      console.log(`  ${chalk.cyan(a.name.padEnd(12))} ${rateColor(`${rate}%`)} success  ${chalk.dim(a.description)}`)
    }
    console.log()
  })

// ─── Shared runner ──────────────────────────────────────────────────────────
async function runAgent(agentName: string | undefined, task: string, opts: { project: string }) {
  const projectRoot = path.resolve(opts.project)
  const projectName = path.basename(projectRoot)

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(chalk.red('Error: ANTHROPIC_API_KEY not set'))
    console.log(chalk.dim('Set it in .env or export it: export ANTHROPIC_API_KEY=sk-ant-...'))
    process.exit(1)
  }

  printHeader(agentName?.toUpperCase() ?? 'NEXUS', projectName)
  console.log(chalk.dim(`Task: ${task}\n`))

  const memory = new NexusMemory(projectName)
  const perception = new NexusPerception(projectRoot, memory)

  // Auto-index if not yet indexed (check by querying memory)
  const hasIndex = memory.search('code', 'semantic', 1).length > 0
  if (!hasIndex) {
    const spinner = ora(chalk.dim('First run — indexing codebase...')).start()
    await perception.indexProject()
    spinner.succeed(chalk.dim('Codebase indexed'))
  }

  const orchestrator = new NexusOrchestrator({
    projectRoot,
    memory,
    perception,
    onToken: (token) => process.stdout.write(token)
  })

  const spinner = ora(chalk.dim(agentName ? `Running ${agentName}...` : 'Routing task...')).start()

  // If we have onToken streaming, stop the spinner before output starts
  let streamStarted = false
  const streamingOrchestrator = new NexusOrchestrator({
    projectRoot,
    memory,
    perception,
    onToken: (token) => {
      if (!streamStarted) {
        spinner.stop()
        console.log() // newline before streamed content
        streamStarted = true
      }
      process.stdout.write(token)
    }
  })

  try {
    const results = await streamingOrchestrator.run(task, agentName)

    if (!streamStarted) spinner.stop()
    console.log('\n')

    // Print findings summary
    for (const [name, result] of results) {
      if (result.findings.length > 0) {
        console.log(chalk.bold(`\n── ${name.toUpperCase()} FINDINGS (${result.findings.length}) ──`))
        for (const f of result.findings) {
          const color = f.severity === 'critical' ? chalk.red.bold
            : f.severity === 'high' ? chalk.red
            : f.severity === 'medium' ? chalk.yellow
            : chalk.dim
          console.log(`\n  ${color(`[${f.severity.toUpperCase()}:${f.confidence}/10]`)} ${chalk.bold(f.title)}`)
          if (f.file) console.log(`  ${chalk.dim(f.file)}`)
          console.log(`  ${f.description}`)
          if (f.fix) console.log(`  ${chalk.green('Fix:')} ${f.fix}`)
          if (f.autoFixable) console.log(`  ${chalk.cyan('⚡ Auto-fixable')}`)
        }
      }

      // Perf info
      console.log(chalk.dim(`\n  ${name}: ${result.durationMs}ms${result.tokensUsed ? ` · ${result.tokensUsed} tokens` : ''}`))
    }
  } catch (err) {
    spinner.fail(chalk.red('Agent failed'))
    console.error(chalk.red(String(err)))
    process.exit(1)
  }
}

function printHeader(agent: string, project: string) {
  console.log()
  console.log(chalk.bold.white('NEXUS') + chalk.dim(` › ${agent} › ${project}`))
  console.log(chalk.dim('─'.repeat(50)))
}

function typeBadge(type: string) {
  const map: Record<string, string> = {
    episodic: chalk.blue('[episodic]'),
    semantic: chalk.green('[semantic]'),
    procedural: chalk.yellow('[procedural]'),
    working: chalk.magenta('[working]'),
  }
  return map[type] ?? chalk.dim(`[${type}]`)
}

program.parseAsync(process.argv)
