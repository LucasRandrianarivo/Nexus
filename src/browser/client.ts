/**
 * Thin HTTP client for the NEXUS browser daemon.
 * ~1ms overhead per command (vs 2-3s for fresh browser spawn).
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync, spawn } from 'child_process'

const CONFIG_DIR = path.join(os.homedir(), '.nexus')
const TOKEN_FILE = path.join(CONFIG_DIR, 'browser.token')
const PID_FILE   = path.join(CONFIG_DIR, 'browser.pid')
const PORT       = 7433
const DAEMON_SCRIPT = new URL('../../dist/browser/daemon.js', import.meta.url).pathname

export interface BrowserResult {
  ok: boolean
  data?: unknown
  error?: string
}

export class BrowserClient {
  private token: string | null = null

  private getToken(): string {
    if (!this.token) {
      if (!fs.existsSync(TOKEN_FILE)) throw new Error('Browser daemon not running. Run `nexus browser start`')
      this.token = fs.readFileSync(TOKEN_FILE, 'utf-8').trim()
    }
    return this.token
  }

  isDaemonRunning(): boolean {
    if (!fs.existsSync(PID_FILE)) return false
    const pid = fs.readFileSync(PID_FILE, 'utf-8').trim()
    try {
      process.kill(parseInt(pid), 0) // signal 0 = check existence
      return true
    } catch {
      fs.unlinkSync(PID_FILE)
      return false
    }
  }

  async startDaemon(): Promise<void> {
    if (this.isDaemonRunning()) return

    const child = spawn('node', [DAEMON_SCRIPT], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env }
    })
    child.unref()

    // Wait for daemon to be ready (max 10s)
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500))
      if (this.isDaemonRunning()) return
    }
    throw new Error('Daemon failed to start')
  }

  async stopDaemon(): Promise<void> {
    if (!this.isDaemonRunning()) return
    await this.send('stop', []).catch(() => {})
  }

  async send(cmd: string, args: unknown[] = []): Promise<BrowserResult> {
    const token = this.getToken()
    const body = JSON.stringify({ cmd, args })

    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: PORT,
        path: '/cmd',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch { reject(new Error('Invalid daemon response')) }
        })
      })

      req.on('error', reject)
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Daemon timeout')) })
      req.write(body)
      req.end()
    })
  }

  // Convenience methods
  async navigate(url: string) { return this.send('navigate', [url]) }
  async snapshot()            { return this.send('snapshot', []) }
  async click(ref: string)    { return this.send('click', [ref]) }
  async type(ref: string, text: string) { return this.send('type', [ref, text]) }
  async press(ref: string, key: string) { return this.send('press', [ref, key]) }
  async screenshot()          { return this.send('screenshot', []) }
  async scroll(dir: 'up' | 'down' = 'down') { return this.send('scroll', [dir]) }
  async back()                { return this.send('back', []) }
  async forward()             { return this.send('forward', []) }
  async url()                 { return this.send('url', []) }
  async evaluate(js: string)  { return this.send('eval', [js]) }
}

export const browser = new BrowserClient()
