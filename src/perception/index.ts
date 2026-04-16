import fs from 'fs'
import path from 'path'
import { glob } from 'glob'
import { NexusMemory } from '../memory/index.js'

export interface CodeChunk {
  filePath: string
  content: string
  language: string
  startLine: number
  endLine: number
  symbols: string[]
}

const IGNORE_PATTERNS = [
  'node_modules/**', '.git/**', 'dist/**', 'build/**', '.next/**',
  '**/*.min.js', '**/*.map', '**/*.lock', '**/package-lock.json'
]

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript',
  '.jsx': 'javascript', '.py': 'python', '.go': 'go', '.rs': 'rust',
  '.java': 'java', '.rb': 'ruby', '.php': 'php', '.swift': 'swift',
  '.kt': 'kotlin', '.cs': 'csharp', '.cpp': 'cpp', '.c': 'c',
  '.md': 'markdown', '.sql': 'sql', '.sh': 'shell', '.yaml': 'yaml',
  '.yml': 'yaml', '.json': 'json', '.env': 'env'
}

export class NexusPerception {
  private projectRoot: string
  private memory: NexusMemory

  constructor(projectRoot: string, memory: NexusMemory) {
    this.projectRoot = projectRoot
    this.memory = memory
  }

  async indexProject(onProgress?: (file: string) => void): Promise<number> {
    const files = await glob('**/*', {
      cwd: this.projectRoot,
      ignore: IGNORE_PATTERNS,
      nodir: true
    })

    let indexed = 0
    for (const file of files) {
      const ext = path.extname(file).toLowerCase()
      if (!LANGUAGE_MAP[ext]) continue

      const fullPath = path.join(this.projectRoot, file)
      try {
        const content = fs.readFileSync(fullPath, 'utf-8')
        if (content.length > 100000) continue // skip huge files

        const chunks = this.chunkFile(content, file, LANGUAGE_MAP[ext])
        for (const chunk of chunks) {
          this.memory.indexCode(
            `File: ${chunk.filePath} (${chunk.language}) L${chunk.startLine}-${chunk.endLine}\n${chunk.symbols.length ? `Symbols: ${chunk.symbols.join(', ')}\n` : ''}\n${chunk.content}`,
            chunk.filePath,
            chunk.symbols[0]
          )
        }

        onProgress?.(file)
        indexed++
      } catch {
        // Skip unreadable files
      }
    }

    this.memory.logSession(`Indexed ${indexed} files from ${this.projectRoot}`, {
      root: this.projectRoot,
      fileCount: indexed
    })

    return indexed
  }

  query(question: string, limit = 5): string {
    const results = this.memory.search(question, 'semantic', limit)
    if (results.length === 0) return 'No relevant code found in index.'

    return results
      .map((r, i) => `--- [${i + 1}] relevance: ${r.relevance.toFixed(2)} ---\n${r.content}`)
      .join('\n\n')
  }

  getProjectStructure(): string {
    const files: string[] = []
    this.walkDir(this.projectRoot, files, 0, 3)
    return files.join('\n')
  }

  detectStack(): Record<string, string> {
    const stack: Record<string, string> = {}

    const checks: [string, string, string][] = [
      ['package.json', 'runtime', 'node'],
      ['requirements.txt', 'runtime', 'python'],
      ['go.mod', 'runtime', 'go'],
      ['Cargo.toml', 'runtime', 'rust'],
      ['Gemfile', 'runtime', 'ruby'],
      ['next.config.*', 'framework', 'nextjs'],
      ['nuxt.config.*', 'framework', 'nuxtjs'],
      ['vite.config.*', 'bundler', 'vite'],
      ['docker-compose.*', 'infra', 'docker'],
      ['Dockerfile', 'infra', 'docker'],
      ['.github/workflows', 'ci', 'github-actions'],
    ]

    for (const [pattern, category, value] of checks) {
      if (fs.existsSync(path.join(this.projectRoot, pattern))) {
        stack[category] = value
      }
    }

    // Detect framework from package.json
    const pkgPath = path.join(this.projectRoot, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        const deps = { ...pkg.dependencies, ...pkg.devDependencies }
        if (deps['react']) stack['ui'] = 'react'
        if (deps['vue']) stack['ui'] = 'vue'
        if (deps['svelte']) stack['ui'] = 'svelte'
        if (deps['express']) stack['server'] = 'express'
        if (deps['fastify']) stack['server'] = 'fastify'
        if (deps['prisma']) stack['orm'] = 'prisma'
        if (deps['drizzle-orm']) stack['orm'] = 'drizzle'
      } catch { /* ignore */ }
    }

    return stack
  }

  private chunkFile(content: string, filePath: string, language: string): CodeChunk[] {
    const lines = content.split('\n')
    const chunks: CodeChunk[] = []
    const chunkSize = 60 // lines per chunk

    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunkLines = lines.slice(i, i + chunkSize)
      const chunkContent = chunkLines.join('\n')
      const symbols = this.extractSymbols(chunkContent, language)

      chunks.push({
        filePath,
        content: chunkContent,
        language,
        startLine: i + 1,
        endLine: Math.min(i + chunkSize, lines.length),
        symbols
      })
    }

    return chunks
  }

  private extractSymbols(content: string, language: string): string[] {
    const patterns: Record<string, RegExp[]> = {
      typescript: [
        /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
        /(?:export\s+)?class\s+(\w+)/g,
        /(?:export\s+)?(?:const|let)\s+(\w+)\s*=/g,
        /(?:export\s+)?(?:interface|type)\s+(\w+)/g,
      ],
      python: [
        /def\s+(\w+)\s*\(/g,
        /class\s+(\w+)[\s(:]/g,
      ],
      go: [
        /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/g,
        /type\s+(\w+)\s+struct/g,
      ]
    }

    const langPatterns = patterns[language] || patterns['typescript']
    const symbols: string[] = []

    for (const pattern of langPatterns) {
      const matches = [...content.matchAll(pattern)]
      symbols.push(...matches.map(m => m[1]).filter(Boolean))
    }

    return [...new Set(symbols)].slice(0, 10)
  }

  private walkDir(dir: string, files: string[], depth: number, maxDepth: number) {
    if (depth > maxDepth) return
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) continue
        const indent = '  '.repeat(depth)
        if (entry.isDirectory()) {
          files.push(`${indent}${entry.name}/`)
          this.walkDir(path.join(dir, entry.name), files, depth + 1, maxDepth)
        } else {
          files.push(`${indent}${entry.name}`)
        }
      }
    } catch { /* ignore */ }
  }
}
