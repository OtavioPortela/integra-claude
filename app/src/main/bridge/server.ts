// Servidor local que conversa com a extensão do Chrome e com a extensão do VS Code.
// - Escuta só em 127.0.0.1.
// - Exige token na primeira mensagem (hello).
// - Aceita Origin apenas da extensão do Chrome com ID fixo; clientes sem Origin (VS Code) também
//   precisam do token. Qualquer página web (Origin http/https) é recusada.
import { WebSocketServer, WebSocket } from 'ws'
import crypto from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { EventEmitter } from 'node:events'

export const CHROME_EXTENSION_ID = 'flkhnafholknnhekibjideljokgjencm'

export type ClientRole = 'chrome' | 'vscode'

export interface BridgeClient {
  id: string
  role: ClientRole
  label: string
  call<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  return origin === `chrome-extension://${CHROME_EXTENSION_ID}`
}

export function tokensMatch(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export class BridgeServer extends EventEmitter {
  private wss: WebSocketServer | null = null
  private clients = new Map<WebSocket, BridgeClient>()

  constructor(private token: string) {
    super()
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: '127.0.0.1',
        port,
        maxPayload: 64 * 1024 * 1024,
        verifyClient: (info: { origin: string; req: IncomingMessage }) =>
          isAllowedOrigin(info.req.headers.origin)
      })
      wss.once('listening', () => {
        this.wss = wss
        resolve()
      })
      wss.once('error', reject)
      wss.on('connection', (ws) => this.onConnection(ws))
    })
  }

  close(): void {
    this.wss?.close()
  }

  list(role: ClientRole): BridgeClient[] {
    return [...this.clients.values()].filter((c) => c.role === role)
  }

  private onConnection(ws: WebSocket): void {
    const pending = new Map<string, Pending>()
    let client: BridgeClient | null = null
    const helloTimer = setTimeout(() => ws.close(4001, 'hello timeout'), 5000)

    ws.on('message', (raw) => {
      let msg: any
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (!client) {
        if (msg?.type !== 'hello' || !tokensMatch(msg.token, this.token)) {
          ws.close(4003, 'unauthorized')
          return
        }
        if (msg.role !== 'chrome' && msg.role !== 'vscode') {
          ws.close(4004, 'bad role')
          return
        }
        clearTimeout(helloTimer)
        client = {
          id: String(msg.clientId || crypto.randomUUID()),
          role: msg.role,
          label: String(msg.label || msg.role),
          call: (method, params, timeoutMs = 30000) =>
            new Promise((resolve, reject) => {
              const id = crypto.randomUUID()
              const timer = setTimeout(() => {
                pending.delete(id)
                reject(new Error(`Tempo esgotado: ${method}`))
              }, timeoutMs)
              pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
              ws.send(JSON.stringify({ type: 'req', id, method, params }))
            })
        }
        this.clients.set(ws, client)
        ws.send(JSON.stringify({ type: 'welcome' }))
        this.emit('change')
        return
      }
      if (msg.type === 'res' && pending.has(msg.id)) {
        const p = pending.get(msg.id)!
        pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.ok) p.resolve(msg.result)
        else p.reject(new Error(msg.error || 'Erro no cliente'))
      } else if (msg.type === 'event') {
        this.emit('client-event', client, msg.name, msg.data)
      }
    })

    // Mantém o service worker do Chrome acordado e detecta conexões mortas.
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
    }, 20000)

    ws.on('close', () => {
      clearTimeout(helloTimer)
      clearInterval(ping)
      for (const p of pending.values()) {
        clearTimeout(p.timer)
        p.reject(new Error('Cliente desconectado'))
      }
      pending.clear()
      if (this.clients.delete(ws)) this.emit('change')
    })
    ws.on('error', () => {})
  }
}
