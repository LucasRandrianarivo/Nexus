#!/usr/bin/env node
/**
 * NEXUS Browser Daemon
 * Persistent Chromium process controlled via local HTTP.
 * Same architecture as gstack's browser daemon — but in Node.js, not Bun.
 *
 * Start: node dist/browser/daemon.js
 * Auth:  Bearer token stored in ~/.nexus/browser.token
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { chromium, Browser, BrowserContext, Page } from 'playwright'

const CONFIG_DIR = path.join(os.homedir(), '.nexus')
const TOKEN_FILE = path.join(CONFIG_DIR, 'browser.token')
const PID_FILE   = path.join(CONFIG_DIR, 'browser.pid')
const PORT       = 7433

// Ref → locator map (cleared on navigation)
const refMap = new Map<string, string>() // ref → selector description
let refCounter = 0

let browser: Browser | null = null
let context: BrowserContext | null = null
let page: Page | null = null
let idleTimer: NodeJS.Timeout | null = null
const IDLE_TIMEOUT = 30 * 60 * 1000 // 30 min

// ── Token ────────────────────────────────────────────────────────────────────
function getOrCreateToken(): string {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, 'utf-8').trim()
  const token = crypto.randomUUID()
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 })
  return token
}

// ── Browser lifecycle ────────────────────────────────────────────────────────
async function ensureBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: false })
    context = await browser.newContext()
    page = await context.newPage()

    page.on('load', () => {
      refMap.clear()
      refCounter = 0
    })
  }
  resetIdleTimer()
  return page!
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(async () => {
    console.log('[nexus-browser] Idle timeout — shutting down')
    await shutdown()
  }, IDLE_TIMEOUT)
}

async function shutdown() {
  if (browser) await browser.close().catch(() => {})
  if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE)
  process.exit(0)
}

// ── Accessibility snapshot ───────────────────────────────────────────────────
async function snapshot(pg: Page): Promise<string> {
  refMap.clear()
  refCounter = 0

  // Use ariaSnapshot (Playwright 1.46+) — compact ARIA tree
  try {
    const ariaTree = await pg.locator('body').ariaSnapshot()
    // Assign refs to interactive elements line by line
    const lines = ariaTree.split('\n')
    const annotated = lines.map(line => {
      const isInteractive = /\b(button|link|textbox|checkbox|radio|combobox|listitem|option|menuitem)\b/i.test(line)
      if (isInteractive) {
        const ref = `@e${++refCounter}`
        refMap.set(ref, line.trim())
        return `${ref} ${line}`
      }
      return line
    })
    return annotated.join('\n')
  } catch {
    // Fallback: get all interactive elements
    const elements = await pg.locator('button, a, input, select, textarea, [role="button"]').all()
    const lines: string[] = [`URL: ${pg.url()}`]
    for (const el of elements.slice(0, 50)) {
      const ref = `@e${++refCounter}`
      const text = await el.textContent().catch(() => '')
      const tag = await el.evaluate(e => e.tagName.toLowerCase()).catch(() => '?')
      const type = await el.getAttribute('type').catch(() => null)
      const placeholder = await el.getAttribute('placeholder').catch(() => null)
      const label = text?.trim() || placeholder || type || tag
      refMap.set(ref, label ?? ref)
      lines.push(`${ref} [${tag}] "${label}"`)
    }
    return lines.join('\n')
  }
}

async function resolveRef(pg: Page, ref: string) {
  if (!refMap.has(ref)) throw new Error(`Unknown ref ${ref}. Run snapshot first.`)

  const idx = parseInt(ref.slice(2)) - 1
  const interactiveSelector = 'button, a, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="combobox"], [role="option"], [role="menuitem"], [role="listitem"]'
  const all = await pg.locator(interactiveSelector).all()

  if (idx >= 0 && idx < all.length) {
    const loc = all[idx]
    if (await loc.count() > 0) return loc
  }

  throw new Error(`Ref ${ref} is stale — re-run SNAPSHOT.`)
}

// ── Command handlers ─────────────────────────────────────────────────────────
type CommandResult = { ok: boolean; data?: unknown; error?: string }

async function handleCommand(cmd: string, args: unknown[]): Promise<CommandResult> {
  const pg = await ensureBrowser()

  switch (cmd) {
    case 'navigate': {
      const url = args[0] as string
      await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      return { ok: true, data: { url: pg.url(), title: await pg.title() } }
    }

    case 'snapshot': {
      const tree = await snapshot(pg)
      return { ok: true, data: { tree, url: pg.url(), refs: refCounter } }
    }

    case 'click': {
      const ref = args[0] as string
      const loc = await resolveRef(pg, ref)
      await loc.click({ timeout: 5000 })
      return { ok: true, data: { clicked: ref } }
    }

    case 'type': {
      const [ref, text] = args as [string, string]
      const loc = await resolveRef(pg, ref)
      await loc.fill(text)
      return { ok: true, data: { typed: text.length + ' chars' } }
    }

    case 'press': {
      const [ref, key] = args as [string, string]
      const loc = await resolveRef(pg, ref)
      await loc.press(key)
      return { ok: true, data: { pressed: key } }
    }

    case 'screenshot': {
      const screenshotPath = path.join(CONFIG_DIR, `screenshot-${Date.now()}.png`)
      await pg.screenshot({ path: screenshotPath, fullPage: false })
      return { ok: true, data: { path: screenshotPath } }
    }

    case 'scroll': {
      const dir = (args[0] as string) ?? 'down'
      const delta = dir === 'down' ? 600 : -600
      await pg.mouse.wheel(0, delta)
      return { ok: true, data: { scrolled: dir } }
    }

    case 'back': {
      await pg.goBack()
      return { ok: true, data: { url: pg.url() } }
    }

    case 'forward': {
      await pg.goForward()
      return { ok: true, data: { url: pg.url() } }
    }

    case 'eval': {
      const js = args[0] as string
      const result = await pg.evaluate(js)
      return { ok: true, data: result }
    }

    case 'url': {
      return { ok: true, data: { url: pg.url(), title: await pg.title() } }
    }

    case 'stop': {
      setTimeout(shutdown, 100)
      return { ok: true, data: { message: 'Daemon shutting down' } }
    }

    default:
      return { ok: false, error: `Unknown command: ${cmd}` }
  }
}

// ── HTTP Server ──────────────────────────────────────────────────────────────
async function main() {
  const token = getOrCreateToken()

  // Write PID
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(PID_FILE, String(process.pid))

  const server = http.createServer(async (req, res) => {
    // Auth
    const auth = req.headers['authorization']
    if (auth !== `Bearer ${token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    // Only accept POST /cmd
    if (req.method !== 'POST' || req.url !== '/cmd') {
      res.writeHead(404)
      res.end()
      return
    }

    let body = ''
    for await (const chunk of req) body += chunk
    const { cmd, args = [] } = JSON.parse(body)

    try {
      const result = await handleCommand(cmd, args)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: String(e) }))
    }
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[nexus-browser] Daemon running on 127.0.0.1:${PORT}`)
    console.log(`[nexus-browser] PID: ${process.pid}`)
  })

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(e => {
  console.error('[nexus-browser] Fatal:', e)
  process.exit(1)
})
