import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'

export interface MemoryEntry {
  id: string
  type: 'episodic' | 'semantic' | 'procedural' | 'working'
  project: string
  content: string
  metadata: Record<string, unknown>
  score?: number
  created_at: number
  updated_at: number
}

export interface SearchResult extends MemoryEntry {
  relevance: number
}

export class NexusMemory {
  private db: Database.Database
  private project: string

  constructor(project: string) {
    this.project = project
    const dbDir = path.join(os.homedir(), '.nexus')
    fs.mkdirSync(dbDir, { recursive: true })
    const dbPath = path.join(dbDir, 'nexus.db')
    this.db = new Database(dbPath)
    this.init()
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        project TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        score REAL DEFAULT 0,
        tokens TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_project_type ON memories(project, type);
      CREATE INDEX IF NOT EXISTS idx_updated ON memories(updated_at DESC);

      CREATE TABLE IF NOT EXISTS agent_metrics (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        task_type TEXT NOT NULL,
        success INTEGER NOT NULL,
        duration_ms INTEGER,
        human_score INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_project ON agent_metrics(project, agent_name);
    `)
  }

  save(entry: Omit<MemoryEntry, 'id' | 'created_at' | 'updated_at'>): string {
    const id = crypto.randomUUID()
    const now = Date.now()
    // Simple BM25-style tokenization for search
    const tokens = this.tokenize(entry.content)
    this.db.prepare(`
      INSERT INTO memories (id, type, project, content, metadata, score, tokens, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.type,
      entry.project,
      entry.content,
      JSON.stringify(entry.metadata),
      entry.score ?? 0,
      tokens,
      now,
      now
    )
    return id
  }

  search(query: string, type?: MemoryEntry['type'], limit = 10): SearchResult[] {
    const queryTokens = this.tokenize(query).split(' ')
    const condition = type ? `AND type = '${type}'` : ''

    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE project = ? ${condition}
      ORDER BY updated_at DESC
      LIMIT 200
    `).all(this.project) as (MemoryEntry & { tokens: string; metadata: string })[]

    return rows
      .map(row => ({
        ...row,
        metadata: JSON.parse(row.metadata as unknown as string),
        relevance: this.bm25Score(queryTokens, row.tokens)
      }))
      .filter(r => r.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit)
  }

  // Episodic: log what happened
  logSession(summary: string, metadata: Record<string, unknown> = {}) {
    return this.save({ type: 'episodic', project: this.project, content: summary, metadata })
  }

  // Semantic: store code knowledge
  indexCode(content: string, filePath: string, symbol?: string) {
    return this.save({
      type: 'semantic',
      project: this.project,
      content,
      metadata: { filePath, symbol }
    })
  }

  // Procedural: store what worked / didn't
  learnPattern(pattern: string, outcome: 'success' | 'failure', context: string) {
    return this.save({
      type: 'procedural',
      project: this.project,
      content: `[${outcome.toUpperCase()}] ${pattern}\nContext: ${context}`,
      metadata: { outcome, pattern }
    })
  }

  // Working: current task state
  setWorkingContext(key: string, value: string) {
    const existing = this.db.prepare(
      `SELECT id FROM memories WHERE project = ? AND type = 'working' AND json_extract(metadata, '$.key') = ?`
    ).get(this.project, key) as { id: string } | undefined

    if (existing) {
      this.db.prepare(
        `UPDATE memories SET content = ?, updated_at = ? WHERE id = ?`
      ).run(value, Date.now(), existing.id)
      return existing.id
    }
    return this.save({ type: 'working', project: this.project, content: value, metadata: { key } })
  }

  getWorkingContext(key: string): string | null {
    const row = this.db.prepare(
      `SELECT content FROM memories WHERE project = ? AND type = 'working' AND json_extract(metadata, '$.key') = ?`
    ).get(this.project, key) as { content: string } | undefined
    return row?.content ?? null
  }

  recordMetric(agentName: string, taskType: string, success: boolean, durationMs?: number) {
    this.db.prepare(`
      INSERT INTO agent_metrics (id, project, agent_name, task_type, success, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), this.project, agentName, taskType, success ? 1 : 0, durationMs ?? null, Date.now())
  }

  getAgentSuccessRate(agentName: string): number {
    const result = this.db.prepare(`
      SELECT AVG(success) as rate FROM agent_metrics
      WHERE project = ? AND agent_name = ?
      ORDER BY created_at DESC LIMIT 20
    `).get(this.project, agentName) as { rate: number } | undefined
    return result?.rate ?? 1.0
  }

  private tokenize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2)
      .join(' ')
  }

  private bm25Score(queryTokens: string[], docTokens: string, k1 = 1.5, b = 0.75): number {
    const doc = docTokens.split(' ')
    const avgLen = 50
    const tf = (term: string) => doc.filter(t => t === term).length
    return queryTokens.reduce((score, term) => {
      const f = tf(term)
      if (f === 0) return score
      const idf = Math.log(1 + 1 / (0.5 + f))
      const termScore = idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * doc.length / avgLen)))
      return score + termScore
    }, 0)
  }
}
