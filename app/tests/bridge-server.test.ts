import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { BridgeServer, CHROME_EXTENSION_ID, isAllowedOrigin } from '../src/main/bridge/server'

const TOKEN = 'a'.repeat(48)
const PORT = 47899
let server: BridgeServer

beforeAll(async () => {
  server = new BridgeServer(TOKEN)
  await server.listen(PORT)
})
afterAll(() => server.close())

function open(origin?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, origin ? { origin } : {})
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
    ws.once('unexpected-response', () => reject(new Error('recusado')))
  })
}

describe('BridgeServer', () => {
  it('aceita só a origem da extensão (ou nenhuma origem)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true)
    expect(isAllowedOrigin(`chrome-extension://${CHROME_EXTENSION_ID}`)).toBe(true)
    expect(isAllowedOrigin('https://site-malicioso.com')).toBe(false)
    expect(isAllowedOrigin('chrome-extension://outraextensao')).toBe(false)
  })

  it('recusa conexão vinda de página web', async () => {
    await expect(open('https://evil.example')).rejects.toThrow()
  })

  it('fecha a conexão com token errado', async () => {
    const ws = await open()
    const code = await new Promise<number>((r) => {
      ws.on('close', (c) => r(c))
      ws.send(JSON.stringify({ type: 'hello', role: 'vscode', token: 'errado' }))
    })
    expect(code).toBe(4003)
  })

  it('aceita token certo e faz chamadas request/response', async () => {
    const ws = await open(`chrome-extension://${CHROME_EXTENSION_ID}`)
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'req') ws.send(JSON.stringify({ type: 'res', id: m.id, ok: true, result: { echo: m.params } }))
    })
    ws.send(JSON.stringify({ type: 'hello', role: 'chrome', token: TOKEN }))
    await new Promise((r) => setTimeout(r, 100))
    const [client] = server.list('chrome')
    expect(await client.call('ping', { x: 1 })).toEqual({ echo: { x: 1 } })
    ws.close()
  })
})
