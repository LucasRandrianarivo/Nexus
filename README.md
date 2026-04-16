# NEXUS

**Stateful multi-agent engineering OS built on Claude — semantic memory, objective evaluation, no prompt chaining.**

> Built to go further than gstack.

---

## Why NEXUS

Most AI coding tools are prompt wrappers. NEXUS is different:

| Dimension | Typical tools | NEXUS |
|---|---|---|
| Agent state | Reloaded every session | Persistent across sessions |
| Memory | None or flat JSONL | 4-layer semantic memory |
| Codebase context | Full file dumps | BM25 index — relevant chunks only |
| Routing | Hardcoded rules | Success-rate based |
| Evaluation | LLM judges LLM | Tests + lint + coverage (objective) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      NEXUS CORE                         │
│                                                         │
│  ┌─────────────┐    ┌──────────────┐   ┌────────────┐  │
│  │  PERCEPTION │───▶│ ORCHESTRATOR │──▶│   AGENTS   │  │
│  │  (Index)    │    │  (Routing)   │   │  (4 spec.) │  │
│  └──────┬──────┘    └──────┬───────┘   └─────┬──────┘  │
│         │                  │                  │         │
│         └──────────┬───────┘                  │         │
│                    ▼                          │         │
│            ┌───────────────┐                  │         │
│            │    MEMORY     │◀─────────────────┘         │
│            │  episodic     │                            │
│            │  semantic     │                            │
│            │  procedural   │                            │
│            │  working      │                            │
│            └───────────────┘                            │
│                    │                                    │
│                    ▼                                    │
│            ┌───────────────┐                            │
│            │  EVALUATION   │                            │
│            │  (Objective)  │                            │
│            └───────────────┘                            │
└─────────────────────────────────────────────────────────┘
```

---

## Agents

| Command | Agent | What it does |
|---|---|---|
| `nexus review` | ReviewAgent | Paranoid pre-merge code review — real bugs, not style |
| `nexus security` | SecurityAgent | 360° attack surface scan (OWASP, STRIDE, secrets, supply chain) |
| `nexus architect "feature X"` | ArchitectAgent | Surfaces ambiguities BEFORE you write a single line |
| `nexus qa` | QAAgent | Test coverage gaps, edge cases, test plan |
| `nexus eval` | Evaluation | Objective score: tests + lint + coverage (no LLM bias) |
| `nexus index` | Perception | Index codebase into semantic memory |
| `nexus memory "query"` | Memory | Search project memory across all 4 layers |
| `nexus agents` | Orchestrator | List agents + real success rates |

---

## Install

**Requirements:** Node.js 18+, an [Anthropic API key](https://console.anthropic.com)

```bash
git clone https://github.com/LucasRandrianarivo/Nexus.git
cd Nexus
./setup
```

The setup script installs deps, builds, links `nexus` globally, and saves your API key to `~/.nexus/.env`.

---

## Usage

```bash
# Point nexus at any project
nexus review -p ~/your-project
nexus security -p ~/your-project
nexus architect "add JWT auth" -p ~/your-project
nexus qa -p ~/your-project
nexus eval -p ~/your-project

# Smart routing — nexus picks the right agent
nexus ask "is the auth flow secure?" -p ~/your-project

# Explore memory
nexus memory "authentication" -p ~/your-project
```

---

## Memory System

NEXUS builds a persistent knowledge base for each project under `~/.nexus/nexus.db`:

- **Episodic** — what happened in past sessions (decisions, errors, outcomes)
- **Semantic** — what the code means (indexed chunks, searchable by intent)
- **Procedural** — what worked and what didn't (patterns learned over time)
- **Working** — current task context

Memory is queried via BM25 before every agent call — only relevant context is injected.

---

## Stack

- **Runtime:** Node.js 18+ / TypeScript
- **LLM:** Claude (Anthropic SDK) with streaming
- **Storage:** SQLite via better-sqlite3
- **Search:** BM25 (no embedding API required)
- **CLI:** Commander.js + Chalk + Ora

---

## Roadmap

- [ ] `nexus code "feature X"` — implement features with codebase context
- [ ] `nexus fix` — auto-fix findings from review agent
- [ ] `nexus ship` — commit → test → PR in one command
- [ ] Vector embeddings (voyage-code-3) for semantic search upgrade
- [ ] Web dashboard for memory + metrics visualization

---

## License

MIT
