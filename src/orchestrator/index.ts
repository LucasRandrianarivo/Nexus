import { NexusMemory } from '../memory/index.js'
import { NexusPerception } from '../perception/index.js'
import { BaseAgent, AgentContext, AgentResult } from '../agents/base.js'
import { ReviewAgent } from '../agents/review.js'
import { SecurityAgent } from '../agents/security.js'
import { ArchitectAgent } from '../agents/architect.js'
import { QAAgent } from '../agents/qa.js'

export interface OrchestratorConfig {
  projectRoot: string
  memory: NexusMemory
  perception: NexusPerception
  model?: string
  onToken?: (token: string) => void
}

export interface RoutingDecision {
  agents: BaseAgent[]
  parallel: boolean
  reason: string
}

// Registry of all available agents
const AGENT_REGISTRY: Record<string, () => BaseAgent> = {
  review: () => new ReviewAgent(),
  security: () => new SecurityAgent(),
  architect: () => new ArchitectAgent(),
  qa: () => new QAAgent(),
}

export class NexusOrchestrator {
  private config: OrchestratorConfig
  private agents: Map<string, BaseAgent>

  constructor(config: OrchestratorConfig) {
    this.config = config
    this.agents = new Map(
      Object.entries(AGENT_REGISTRY).map(([name, factory]) => [name, factory()])
    )
  }

  // Smart routing: pick the right agents based on task + history
  route(task: string, forceAgent?: string): RoutingDecision {
    if (forceAgent) {
      const agent = this.agents.get(forceAgent)
      if (!agent) throw new Error(`Unknown agent: ${forceAgent}. Available: ${[...this.agents.keys()].join(', ')}`)
      return { agents: [agent], parallel: false, reason: `Forced: ${forceAgent}` }
    }

    const taskLower = task.toLowerCase()
    const selectedAgents: BaseAgent[] = []
    let parallel = false

    // Routing rules (learned over time via success rates)
    const rules: [RegExp, string, number][] = [
      // [pattern, agentName, minSuccessRate]
      [/review|diff|pr|merge|code quality|bug/i, 'review', 0],
      [/security|vulnerability|auth|injection|exploit|cve|attack/i, 'security', 0],
      [/plan|architect|design|how to build|implement|feature/i, 'architect', 0],
      [/test|qa|coverage|edge case|regression/i, 'qa', 0],
    ]

    for (const [pattern, agentName, minRate] of rules) {
      if (pattern.test(taskLower)) {
        const rate = this.config.memory.getAgentSuccessRate(agentName)
        if (rate >= minRate) {
          const agent = this.agents.get(agentName)
          if (agent) selectedAgents.push(agent)
        }
      }
    }

    // Fallback: if nothing matched, use architect for planning
    if (selectedAgents.length === 0) {
      selectedAgents.push(this.agents.get('architect')!)
    }

    // Run in parallel if multiple agents selected
    parallel = selectedAgents.length > 1

    return {
      agents: selectedAgents,
      parallel,
      reason: `Matched ${selectedAgents.map(a => a.getName()).join(' + ')} based on task analysis`
    }
  }

  async run(task: string, forceAgent?: string): Promise<Map<string, AgentResult>> {
    const decision = this.route(task, forceAgent)
    const ctx: AgentContext = {
      projectRoot: this.config.projectRoot,
      task,
      memory: this.config.memory,
      perception: this.config.perception,
      model: this.config.model,
      onToken: this.config.onToken
    }

    const results = new Map<string, AgentResult>()

    if (decision.parallel) {
      // Run agents in true parallel
      const promises = decision.agents.map(agent =>
        agent.run(ctx).then(result => {
          results.set(agent.getName(), result)
          return result
        })
      )
      await Promise.all(promises)
    } else {
      // Sequential execution
      for (const agent of decision.agents) {
        const result = await agent.run(ctx)
        results.set(agent.getName(), result)
      }
    }

    return results
  }

  listAgents(): Array<{ name: string; description: string; successRate: number }> {
    return [...this.agents.entries()].map(([name, agent]) => ({
      name,
      description: agent.getDescription(),
      successRate: this.config.memory.getAgentSuccessRate(name)
    }))
  }
}
