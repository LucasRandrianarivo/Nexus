# NEXUS — Wiki complet

> Stateful multi-agent engineering OS built on Claude.
> Version 0.1.0 — [github.com/LucasRandrianarivo/Nexus](https://github.com/LucasRandrianarivo/Nexus)

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Pourquoi NEXUS](#2-pourquoi-nexus)
3. [Architecture](#3-architecture)
4. [Installation](#4-installation)
5. [Configuration](#5-configuration)
6. [Agents](#6-agents)
   - [review](#61-agent-review)
   - [security](#62-agent-security)
   - [architect](#63-agent-architect)
   - [qa](#64-agent-qa)
   - [code](#65-agent-code)
   - [fix](#66-agent-fix)
   - [ship](#67-agent-ship)
   - [browse](#68-agent-browse)
7. [Système de mémoire](#7-système-de-mémoire)
8. [Orchestrateur](#8-orchestrateur)
9. [Perception — Index sémantique](#9-perception--index-sémantique)
10. [Évaluation objective](#10-évaluation-objective)
11. [Browser daemon](#11-browser-daemon)
12. [Workflow complet](#12-workflow-complet)
13. [Référence CLI](#13-référence-cli)
14. [Ajouter un agent](#14-ajouter-un-agent)
15. [Comparaison gstack](#15-comparaison-gstack)
16. [Roadmap](#16-roadmap)
17. [Dépannage](#17-dépannage)

---

## 1. Vue d'ensemble

NEXUS est un **système multi-agents stateful** qui entoure ton workflow d'ingénierie avec :

- **8 agents spécialisés** — chacun expert dans son domaine
- **Mémoire persistante en 4 couches** — le système apprend ton projet au fil du temps
- **Index sémantique** du codebase — le contexte pertinent est injecté automatiquement
- **Routing intelligent** — NEXUS choisit le bon agent selon la tâche et l'historique
- **Évaluation objective** — tests + lint + coverage, sans LLM qui juge du LLM
- **Browser daemon** — Chromium persistant, 100ms par commande

NEXUS n'est pas un chatbot. C'est un **OS d'ingénierie** qui tourne en arrière-plan de ton travail.

---

## 2. Pourquoi NEXUS

### Le problème avec les outils existants

La plupart des outils AI pour le code (gstack inclus) sont des **prompt wrappers** :
- Les "agents" rechargent tout le contexte from scratch à chaque session
- La mémoire est plate (JSONL non interrogeable)
- Le routing est hardcodé dans des règles fixes
- L'évaluation de la qualité est faite par le LLM lui-même (biais évident)

### Ce que NEXUS fait différemment

```
Outil classique :  Prompt → LLM → Réponse
                   (oublie tout à la prochaine session)

NEXUS :            Task → Perception (contexte pertinent)
                        → Memory (historique + patterns)
                        → Orchestrator (bon agent)
                        → Agent (action)
                        → Evaluation (score objectif)
                        → Memory (apprentissage)
```

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      NEXUS CORE                         │
│                                                         │
│  ┌─────────────┐    ┌──────────────┐   ┌────────────┐  │
│  │  PERCEPTION │───▶│ ORCHESTRATOR │──▶│   AGENTS   │  │
│  │             │    │              │   │            │  │
│  │ • AST parse │    │ • Routing    │   │ • review   │  │
│  │ • BM25 idx  │    │ • Parallel   │   │ • security │  │
│  │ • Stack det │    │ • Success rt │   │ • architect│  │
│  └──────┬──────┘    └──────┬───────┘   │ • qa       │  │
│         │                  │           │ • code     │  │
│         └──────────┬───────┘           │ • fix      │  │
│                    ▼                   │ • ship     │  │
│            ┌───────────────┐           │ • browse   │  │
│            │    MEMORY     │◀──────────└────────────┘  │
│            │               │                           │
│            │ • episodic    │                           │
│            │ • semantic    │                           │
│            │ • procedural  │                           │
│            │ • working     │                           │
│            └───────────────┘                           │
│                    │                                   │
│                    ▼                                   │
│            ┌───────────────┐                           │
│            │  EVALUATION   │                           │
│            │               │                           │
│            │ • tests       │                           │
│            │ • lint        │                           │
│            │ • coverage    │                           │
│            └───────────────┘                           │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │              BROWSER DAEMON                     │  │
│  │  Chromium persistant · HTTP local · Refs ARIA   │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Stack technique

| Couche | Technologie | Pourquoi |
|---|---|---|
| Runtime | Node.js 18+ / TypeScript | Stable, typage fort |
| LLM | Claude via Anthropic SDK | Streaming natif |
| Stockage | SQLite (better-sqlite3) | Zéro infrastructure |
| Search | BM25 maison | Pas de dépendance externe |
| CLI | Commander.js + Chalk + Ora | UX terminale propre |
| Browser | Playwright + Chromium | Automation fiable |

---

## 4. Installation

### Prérequis

- Node.js 18+
- Git
- Une clé API Anthropic ([console.anthropic.com](https://console.anthropic.com))

### Installation rapide

```bash
git clone https://github.com/LucasRandrianarivo/Nexus.git
cd Nexus
./setup
```

Le script `./setup` fait automatiquement :
1. Vérifie Node.js 18+
2. Installe les dépendances (`npm install`)
3. Compile TypeScript (`npx tsc`)
4. Link `nexus` globalement (`npm link`)
5. Crée `~/.nexus/` (répertoire de config)
6. Demande et sauvegarde ta clé API dans `~/.nexus/.env`

### Installation manuelle

```bash
git clone https://github.com/LucasRandrianarivo/Nexus.git
cd Nexus
npm install
npx tsc
npm link

# Config
mkdir -p ~/.nexus
echo "ANTHROPIC_API_KEY=sk-ant-..." > ~/.nexus/.env
echo "NEXUS_MODEL=claude-sonnet-4-6" >> ~/.nexus/.env
```

### Installation du browser (optionnel)

```bash
# Télécharge Chromium dédié
PLAYWRIGHT_BROWSERS_PATH=~/.nexus/browsers npx playwright install chromium

# OU utilise Chrome système (macOS)
# Rien à faire — détecté automatiquement
```

---

## 5. Configuration

NEXUS cherche la config dans cet ordre :
1. `~/.nexus/.env` (global)
2. `.env` dans le répertoire courant (par projet)
3. Variables d'environnement système

### Variables disponibles

```env
# Obligatoire
ANTHROPIC_API_KEY=sk-ant-...

# Modèles (optionnel)
NEXUS_MODEL=claude-sonnet-4-6          # modèle principal (agents lourds)
NEXUS_FAST_MODEL=claude-haiku-4-5-20251001  # modèle rapide (commit msg, changelog)

# Stockage (optionnel)
NEXUS_DB_PATH=~/.nexus/nexus.db        # chemin de la base SQLite
```

### Modèles recommandés

| Usage | Modèle |
|---|---|
| Review / Security / Code (précision) | `claude-opus-4-6` |
| Architect / QA / Browse (équilibré) | `claude-sonnet-4-6` |
| Ship / Fix (vitesse) | `claude-haiku-4-5-20251001` |

---

## 6. Agents

### 6.1 Agent `review`

**Commande :** `nexus review [task] -p /projet`

**Rôle :** Code review paranoid sur le diff git courant. Trouve les vrais bugs, pas les problèmes de style.

**Ce qu'il analyse :**
- SQL & sécurité des données
- Race conditions & concurrence
- LLM trust boundaries (si le projet utilise de l'IA)
- Shell injection
- Null pointers & edge cases manquants
- Scope drift (changements hors du périmètre prévu)

**Format de sortie :**
```
[SEVERITY:confidence] TITRE
Description: ...
File: path/to/file.ts:42
Fix: suggestion concrète
AutoFix: yes/no
```

**Niveaux de sévérité :** `CRITICAL` > `HIGH` > `MEDIUM` > `LOW` > `INFO`

**Seuil de confiance :** Seuls les findings >= 6/10 sont reportés.

**Exemple :**
```bash
# Review du diff staged
git add .
nexus review -p ~/mon-projet

# Review avec contexte spécifique
nexus review "focus sur l'authentification" -p ~/mon-projet
```

---

### 6.2 Agent `security`

**Commande :** `nexus security [task] -p /projet`
**Alias :** `nexus cso`

**Rôle :** Scan de surface d'attaque à 360°.

**8 phases de scan :**

| Phase | Ce qui est scanné |
|---|---|
| 1. Secrets | Clés API hardcodées, tokens en clair, fichiers .env trackés |
| 2. Injection | SQL, shell, XSS, SSTI, path traversal |
| 3. Auth & Authz | Sessions, JWT, RBAC, IDOR |
| 4. Supply chain | CVE connus, packages abandonnés, install scripts suspects |
| 5. Data exposure | PII en logs, erreurs verboses, réponses API trop détaillées |
| 6. LLM security | Prompt injection, output non sanitisé utilisé en opérations critiques |
| 7. Infra | CORS permissif, headers manquants, ports ouverts |
| 8. STRIDE | Spoofing, Tampering, Repudiation, Info disclosure, DoS, Elevation |

**Seuil de confiance :** Findings >= 7/10 uniquement (anti-bruit).

**Exemple :**
```bash
nexus security -p ~/mon-projet
nexus cso "focus sur les routes API" -p ~/mon-projet
```

---

### 6.3 Agent `architect`

**Commande :** `nexus architect <task> -p /projet`
**Alias :** `nexus plan`

**Rôle :** Revue technique PRÉ-implémentation. Fait émerger les ambiguïtés avant d'écrire une ligne de code.

**Ce qu'il produit :**
- Liste des ambiguïtés à résoudre (avec recommandations)
- Proposition d'architecture (composants, data flow ASCII)
- Matrice de risques (likelihood × impact × mitigation)
- Ordre d'implémentation avec justification
- Questions bloquantes pour le développeur

**Philosophie :** Poser les bonnes questions pendant la planification coûte 10 minutes. Les poser pendant l'implémentation coûte 2 jours.

**Exemple :**
```bash
nexus architect "ajouter un système de notifications temps réel" -p ~/mon-projet
nexus plan "refactorer le module auth vers JWT" -p ~/mon-projet
```

---

### 6.4 Agent `qa`

**Commande :** `nexus qa [task] -p /projet`

**Rôle :** Analyse de couverture de tests, détection d'edge cases, génération de plan de test.

**Ce qu'il produit :**
- **Coverage gaps** — use cases non testés avec niveau de risque
- **Edge cases** — scénarios qui vont planter en production (null, overflow, concurrence)
- **Test plan** — ordre de priorité avec justification
- **Test stubs** — pseudo-code des tests à écrire

**Exemple :**
```bash
nexus qa -p ~/mon-projet
nexus qa "focus sur le module de paiement" -p ~/mon-projet
```

---

### 6.5 Agent `code`

**Commande :** `nexus code <task> -p /projet`

**Rôle :** Implémente une feature en lisant d'abord les patterns du codebase existant.

**Comportement :**
1. Index le codebase (si pas déjà fait)
2. Cherche les patterns pertinents (naming, architecture, style)
3. Implémente en respectant les conventions existantes
4. Écrit les fichiers directement sur le disque
5. Sauvegarde en mémoire ce qui a été fait

**Format de sortie du LLM :**
```
FILE: src/features/auth.ts
ACTION: create
```typescript
// contenu complet du fichier
```
REASON: pourquoi ce fichier
```

**Règles :**
- Jamais de `// TODO implement this`
- Suit les conventions existantes du projet
- Gère les cas d'erreur
- Implémente exactement ce qui est demandé — rien de plus

**Exemple :**
```bash
nexus code "ajouter un endpoint POST /api/users avec validation" -p ~/mon-projet
nexus code "créer un composant React LoginForm avec email + password" -p ~/mon-front
```

---

### 6.6 Agent `fix`

**Commande :** `nexus fix [task] -p /projet`

**Rôle :** Corrige automatiquement les findings du dernier `nexus review`. Chirurgical — ne touche que ce qu'il faut.

**Pipeline :**
1. Charge les findings depuis la mémoire working (`last_review_findings`)
2. Pour chaque finding : localise le code exact, propose le fix minimal
3. N'applique que les fixes avec confidence >= 7/10
4. Ignore les fixes qui pourraient causer des régressions

**Format de sortie :**
```
FIX: [HIGH] SQL injection in getUserById
FILE: src/db/users.ts
LINE: 42
BEFORE: `SELECT * FROM users WHERE id = ${userId}`
AFTER:  `SELECT * FROM users WHERE id = ?` avec paramètre bindé
CONFIDENCE: 9/10
```

**Workflow typique :**
```bash
nexus review        # identifie les problèmes
nexus fix           # corrige automatiquement (confiance >= 7)
nexus review        # vérifie que les fixes sont bons
```

---

### 6.7 Agent `ship`

**Commande :** `nexus ship [task] -p /projet`

**Rôle :** Pipeline complet de livraison en une commande.

**5 étapes automatiques :**

```
[1/5] Pre-flight checks    → vérifie git repo + changements présents
[2/5] Tests                → npm test (continue même si ça fail, avec warning)
[3/5] Commit message       → généré par Claude Haiku (conventional commits)
[4/5] Commit + Changelog   → git commit + mise à jour CHANGELOG.md
[5/5] Push + PR            → git push + gh pr create (si gh CLI disponible)
```

**Format du changelog (Keep a Changelog) :**
```markdown
## [1.2.0] - 2026-04-16

### Added
- Endpoint POST /api/users avec validation Zod

### Fixed
- SQL injection dans getUserById
```

**Exemple :**
```bash
nexus ship -p ~/mon-projet
nexus ship "release v1.2.0" -p ~/mon-projet
```

---

### 6.8 Agent `browse`

**Commande :** `nexus browse <task> -p /projet`

**Rôle :** Automatisation browser via Chromium persistant. Claude pilote le browser en émettant des commandes.

**Architecture :**
```
nexus browse → BrowseAgent → BrowserClient (HTTP) → Daemon Chromium
                                  ~1ms                  ~100ms
```

**Commandes disponibles dans la boucle :**

| Commande | Description |
|---|---|
| `NAVIGATE url` | Naviguer vers une URL |
| `SNAPSHOT` | Obtenir l'arbre ARIA avec refs (@e1, @e2...) |
| `CLICK @eN` | Cliquer sur un élément par ref |
| `TYPE @eN "text"` | Remplir un champ |
| `PRESS @eN Enter` | Appuyer sur une touche |
| `SCROLL down\|up` | Scroller la page |
| `SCREENSHOT` | Capture d'écran (sauvée dans ~/.nexus/) |
| `BACK` / `FORWARD` | Navigation historique |
| `EVAL "js"` | Évaluer du JavaScript |
| `DONE "résumé"` | Terminer la tâche |

**Système de refs :**
- `SNAPSHOT` génère un arbre ARIA avec des refs séquentiels (`@e1`, `@e2`...)
- Les refs sont réinitialisés à chaque navigation
- Si un ref est stale → `SNAPSHOT` puis réessai

**Exemple :**
```bash
nexus browser start
nexus browse "va sur github.com/LucasRandrianarivo/Nexus et prends un screenshot"
nexus browse "connecte-toi sur localhost:3000 avec admin@test.com / password123"
nexus browse "remplis le formulaire de contact et soumet"
nexus browser stop
```

---

## 7. Système de mémoire

La mémoire est stockée dans `~/.nexus/nexus.db` (SQLite). Elle est **par projet** — identifié par le nom du dossier racine.

### 4 couches

#### Episodic — "Ce qui s'est passé"
Logs de sessions : ce qui a été fait, quels agents ont tourné, combien de findings.
```
[2026-04-16] Review: 3 findings (1 critical)
[2026-04-16] Security scan: 0 findings
[2026-04-16] Shipped: "feat: add JWT auth"
```

#### Semantic — "Ce que le code signifie"
Index du codebase : chunks de code par fichier, avec symboles extraits (fonctions, classes).
Interrogeable par intention (`"comment fonctionne l'auth ?"`)

#### Procedural — "Ce qui marche ou pas"
Patterns appris : succès et échecs enregistrés pour chaque type de tâche.
```
[SUCCESS] JWT implémenté avec refresh tokens - pattern validé
[FAILURE] Race condition détectée dans le cache Redis - anti-pattern enregistré
```

#### Working — "Contexte actuel"
État de la tâche en cours : derniers findings, contexte de la session active.
Utilisé pour enchaîner `nexus review` → `nexus fix` sans répéter le contexte.

### Recherche BM25

Avant chaque appel agent, NEXUS interroge la mémoire :
```
query: "SQL injection vulnerability"
→ cherche dans semantic + procedural
→ injecte les top-5 chunks pertinents dans le contexte
```

BM25 (Best Match 25) : algorithme de ranking basé sur la fréquence des termes — pas besoin d'API d'embeddings externe.

### Commandes mémoire

```bash
# Chercher dans toute la mémoire
nexus memory "authentification" -p ~/mon-projet

# Filtrer par type
nexus memory "bug" -p ~/mon-projet --type episodic
nexus memory "fonction login" -p ~/mon-projet --type semantic
nexus memory "pattern échec" -p ~/mon-projet --type procedural
```

---

## 8. Orchestrateur

L'orchestrateur décide **quel(s) agent(s) lancer** et **comment** (séquentiel ou parallèle).

### Routing par pattern

```
Task: "review du diff avant merge"
→ match /review|diff|pr|merge/i → ReviewAgent

Task: "vérifier les failles de sécurité"
→ match /security|vulnerability/i → SecurityAgent

Task: "implémenter un système de cache Redis"
→ match /implement|build|create/i → CodeAgent
→ match /architect|design/i → ArchitectAgent
→ 2 agents → exécution PARALLÈLE
```

### Routing par taux de succès

Chaque agent a un taux de succès calculé sur les 20 dernières exécutions :
```
SecurityAgent: 92% success → utilisé en priorité
FixAgent: 60% success → utilisé mais surveillé
```

Si le taux tombe sous un seuil → l'agent est déprioritisé automatiquement.

### Parallélisme réel

Quand plusieurs agents correspondent, ils tournent en `Promise.all()` — vrai parallélisme Node.js, pas du batching séquentiel.

### Routing forcé

```bash
nexus ask "ma tâche" -p ~/projet        # routing automatique
nexus review "ma tâche" -p ~/projet     # force ReviewAgent
nexus security "ma tâche" -p ~/projet   # force SecurityAgent
```

---

## 9. Perception — Index sémantique

La perception indexe le codebase avant les appels agents pour injecter **uniquement le code pertinent**.

### Ce qui est indexé

- TypeScript / JavaScript / JSX / TSX
- Python, Go, Rust, Java, Ruby, PHP
- SQL, Shell, YAML, JSON
- Markdown

Ignorés : `node_modules/`, `dist/`, `.git/`, fichiers > 100KB, fichiers minifiés.

### Chunking

Chaque fichier est découpé en chunks de 60 lignes avec extraction des symboles :
```
Chunk: src/auth/jwt.ts L1-60
Symboles: generateToken, verifyToken, JWTPayload
```

### Détection de stack

Détectée automatiquement depuis `package.json`, fichiers de config :
```json
{
  "runtime": "node",
  "framework": "nextjs",
  "bundler": "vite",
  "orm": "prisma",
  "ui": "react",
  "ci": "github-actions"
}
```

Injectée dans le contexte de chaque agent.

### Commandes

```bash
# Indexer un projet
nexus index -p ~/mon-projet

# L'indexation est automatique au premier appel d'un agent
nexus review -p ~/mon-projet   # indexe si pas encore fait
```

---

## 10. Évaluation objective

`nexus eval` produit un score sans biais LLM — basé sur des métriques réelles.

### Calcul du score

```
Score = Tests × 0.5 + Lint × 0.3 + Coverage × 0.2
```

| Métrique | Outil détecté | Score |
|---|---|---|
| Tests | Jest / Vitest / npm test | 0-100 (% passing) |
| Lint | ESLint / TypeScript (`tsc --noEmit`) | 100 - (errors × 10) |
| Coverage | Jest --coverage / Vitest --coverage | % statements |

### Grades

| Score | Grade | Signification |
|---|---|---|
| 90-100 | A | Production-ready |
| 75-89 | B | Bon, quelques ajustements |
| 60-74 | C | Acceptable, améliorer avant merge |
| 40-59 | D | Problèmes significatifs |
| 0-39 | F | Bloquant |

### Exemple de sortie

```
╔══════════════════════════════════════╗
║        NEXUS EVAL REPORT             ║
╚══════════════════════════════════════╝

  Tests    ████████░░ 82/100  (41/50 passing)
  Lint     ██████████ 95/100  (0 errors, 2 warnings)
  Coverage ███████░░░ 68/100  (57%)

  Overall  ████████░░ 83/100  Grade: B

  ✓ No blockers — ready to ship
```

---

## 11. Browser daemon

### Architecture

```
nexus browse "task"
    │
    ▼
BrowseAgent (loop: Claude → commandes → résultats → Claude...)
    │
    ▼
BrowserClient (HTTP POST localhost:7433/cmd)
    │  ~1ms overhead
    ▼
Daemon HTTP Server (Node.js)
    │
    ▼
Chromium (Playwright)
    │  ~100ms par commande
    ▼
Page web
```

### Détection du browser

Ordre de priorité :
1. `~/.nexus/browsers/chromium-1217/` (Chrome for Testing — téléchargé)
2. `/Applications/Google Chrome.app/` (Chrome système macOS)

### Sécurité

- **Localhost only** — bind sur `127.0.0.1:7433`, jamais exposé réseau
- **Bearer token** — UUID généré au premier démarrage, stocké dans `~/.nexus/browser.token` (mode 0600)
- **Idle timeout** — shutdown automatique après 30 minutes d'inactivité
- **PID file** — `~/.nexus/browser.pid` pour détecter si le daemon tourne

### Cycle de vie des refs

```
SNAPSHOT → @e1 button "Login", @e2 input "Email"...
CLICK @e1 → ok
[navigation vers nouvelle page]
→ refs réinitialisés automatiquement
SNAPSHOT → @e1 button "Logout", @e2 link "Profile"...
```

### Gestion du daemon

```bash
nexus browser start    # démarre le daemon en arrière-plan
nexus browser status   # vérifie s'il tourne
nexus browser stop     # arrêt propre
```

---

## 12. Workflow complet

### Workflow typique d'une feature

```bash
# 1. Planifier avant de coder
nexus architect "ajouter un système de notifications" -p ~/mon-projet

# 2. Implémenter
nexus code "système de notifications avec WebSockets" -p ~/mon-projet

# 3. Review paranoid
git add .
nexus review -p ~/mon-projet

# 4. Corriger les findings
nexus fix -p ~/mon-projet

# 5. Analyse de test
nexus qa -p ~/mon-projet

# 6. Score objectif
nexus eval -p ~/mon-projet

# 7. Livrer
nexus ship -p ~/mon-projet
```

### Workflow sécurité

```bash
# Scan complet avant une mise en production
nexus security -p ~/mon-projet

# Focus sur un aspect spécifique
nexus security "focus sur les endpoints API publics" -p ~/mon-projet
```

### Workflow QA avec browser

```bash
nexus browser start
nexus browse "teste le flow de login sur localhost:3000" -p ~/mon-projet
nexus browse "vérifie que le formulaire d'inscription valide correctement les emails" -p ~/mon-projet
nexus browser stop
```

### Workflow de debug

```bash
# Chercher dans la mémoire du projet
nexus memory "erreur auth" -p ~/mon-projet
nexus memory "pattern JWT" -p ~/mon-projet --type procedural

# Voir l'historique des sessions
nexus memory "session" -p ~/mon-projet --type episodic
```

---

## 13. Référence CLI

```
nexus <commande> [options]

Commandes :
  review   [task]   Paranoid code review sur le diff git
  security [task]   Scan sécurité 360° (alias: cso)
  architect <task>  Revue pré-implémentation (alias: plan)
  qa       [task]   Analyse couverture + edge cases
  code     <task>   Implémentation avec contexte codebase
  fix      [task]   Auto-fix des findings du dernier review
  ship     [task]   Pipeline complet : eval → commit → push → PR
  browse   <task>   Automatisation browser via daemon Chromium
  browser  <action> Gérer le daemon : start | stop | status
  ask      <task>   Routing automatique vers le bon agent
  eval              Score objectif : tests + lint + coverage
  index             Indexer le codebase en mémoire sémantique
  memory   [query]  Rechercher dans la mémoire projet (alias: mem)
  agents            Lister les agents + taux de succès

Options globales :
  -p, --project <path>   Racine du projet (défaut: répertoire courant)
  -V, --version          Version de NEXUS
  -h, --help             Aide

Options memory :
  -t, --type <type>      episodic | semantic | procedural | working
```

---

## 14. Ajouter un agent

Créer un agent prend < 30 minutes. Voici la procédure complète.

### Étape 1 — Créer le fichier agent

```typescript
// src/agents/mon-agent.ts
import { BaseAgent, AgentContext, AgentResult } from './base.js'

const SYSTEM_PROMPT = `Tu es un expert en X. Tu fais Y.

Format de sortie:
...`

export class MonAgent extends BaseAgent {
  constructor() {
    super('mon-agent', 'Description courte de ce que fait l\'agent')
  }

  async run(ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now()

    // 1. Construire le contexte (mémoire + perception)
    const context = this.buildContext(ctx, ctx.task)

    // 2. Appeler Claude
    const response = await this.callClaude(SYSTEM_PROMPT, `${context}\n\nTask: ${ctx.task}`, ctx)

    // 3. Logger en mémoire
    ctx.memory.logSession(`MonAgent: ${ctx.task.slice(0, 60)}`, { agent: 'mon-agent' })
    ctx.memory.recordMetric('mon-agent', 'task_type', true, Date.now() - start)

    return {
      success: true,
      output: response.text,
      findings: [],
      durationMs: Date.now() - start,
      tokensUsed: response.inputTokens + response.outputTokens
    }
  }
}
```

### Étape 2 — Enregistrer dans l'orchestrateur

```typescript
// src/orchestrator/index.ts
import { MonAgent } from '../agents/mon-agent.js'

const AGENT_REGISTRY = {
  // ...agents existants...
  'mon-agent': () => new MonAgent(),
}

// Ajouter la règle de routing
const rules = [
  // ...règles existantes...
  [/keyword1|keyword2/i, 'mon-agent', 0],
]
```

### Étape 3 — Ajouter la commande CLI

```typescript
// src/cli/index.ts
program
  .command('mon-agent <task>')
  .description('Description pour le --help')
  .option('-p, --project <path>', 'Project root', process.cwd())
  .action(async (task, opts) => {
    await runAgent('mon-agent', task, opts)
  })
```

### Étape 4 — Builder et tester

```bash
npx tsc
npm link
nexus mon-agent "test" -p ~/mon-projet
```

---

## 15. Comparaison gstack

| Dimension | gstack | NEXUS |
|---|---|---|
| **Nature** | Collection de prompts markdown | Agents TypeScript stateful |
| **Mémoire** | JSONL plat | 4 couches SQLite + BM25 |
| **Context codebase** | Rechargé from scratch | Index sémantique persistant |
| **Routing** | Règles hardcodées | Basé sur taux de succès réels |
| **Évaluation** | LLM juge LLM | Tests + lint + coverage objectifs |
| **Parallelisme** | Prompt batching | Promise.all() réel |
| **Browser** | Daemon Bun | Daemon Node.js |
| **Écriture de code** | Skills markdown | Agent code TypeScript |
| **Review** | /review skill | nexus review |
| **Sécurité** | /cso (14 phases) | nexus security (8 phases) |
| **Ship** | /ship complet | nexus ship |
| **Extensibilité** | Modifier des .md | Ajouter un fichier .ts |
| **Maturité** | 6 mois de prod | v0.1.0 |
| **Tests** | E2E + LLM eval | À implémenter |

### Ce que gstack fait mieux

- **Maturité** — 6 mois de tests en production réelle
- **Nombre de skills** — 35+ vs 8 agents
- **Design agents** — `/design-html`, mockup-to-code
- **Multi-platform** — adapters pour 8 outils AI

### Ce que NEXUS fait mieux

- **Architecture** — agents stateful vs prompt wrappers
- **Mémoire** — structurée et interrogeable vs flat
- **Évaluation** — objective vs biaisée
- **Extensibilité** — TypeScript typé vs markdown éditable

---

## 16. Roadmap

### v0.2.0 — Tests & fiabilité
- [ ] Suite de tests E2E pour chaque agent
- [ ] Retry automatique sur timeout API
- [ ] Mode `--dry-run` (montre ce qui serait fait sans l'exécuter)

### v0.3.0 — Embeddings réels
- [ ] Intégration Voyage AI (voyage-code-3) pour embeddings sémantiques
- [ ] Remplacement BM25 par vector search
- [ ] Recherche cross-projet dans la mémoire

### v0.4.0 — Agents design
- [ ] `nexus design "composant X"` — génère du HTML/CSS/React à partir d'une description
- [ ] `nexus mockup` — convertit une description en maquette HTML interactive

### v0.5.0 — Dashboard
- [ ] Interface web locale (`nexus dashboard`)
- [ ] Visualisation de la mémoire projet
- [ ] Historique des sessions + métriques agents
- [ ] Comparaison avant/après sur les evals

### v1.0.0 — Production-ready
- [ ] Multi-projet (orchestration cross-repos)
- [ ] API REST pour intégration CI/CD
- [ ] Plugin VS Code
- [ ] Support Windows (WSL2)

---

## 17. Dépannage

### `ANTHROPIC_API_KEY not set`

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > ~/.nexus/.env
```

### `Unknown agent: X`

```bash
nexus agents   # liste les agents disponibles
```

### Le browser daemon ne démarre pas

```bash
# Vérifier que Chrome est installé
ls "/Applications/Google Chrome.app" 2>/dev/null && echo "OK"

# Vérifier que Playwright peut le trouver
node -e "const {chromium} = require('playwright'); chromium.launch().then(b => { console.log('OK'); b.close(); })"

# Vérifier les logs du daemon
nexus browser status
cat ~/.nexus/browser.pid
```

### `Ref @e1 is stale`

Les refs sont réinitialisés à chaque navigation. Relancer `SNAPSHOT` dans la boucle browse.

### `No changes detected` (nexus review)

Le review analyse le diff git. Il faut stager des changements :
```bash
git add .
nexus review -p ~/mon-projet

# Ou comparer avec le commit précédent (auto-détecté)
nexus review -p ~/mon-projet
```

### La mémoire est vide

Lancer l'indexation manuellement :
```bash
nexus index -p ~/mon-projet
```

### Rebuild complet

```bash
cd ~/nexus
npm install
npx tsc
npm link
```

---

*NEXUS est open source — MIT License.*
*Contributions bienvenues : [github.com/LucasRandrianarivo/Nexus](https://github.com/LucasRandrianarivo/Nexus)*
