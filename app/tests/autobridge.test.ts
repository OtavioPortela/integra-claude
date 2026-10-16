import { describe, expect, it, vi } from 'vitest'
import { AutoBridge, RETRY_DELAYS_MS } from '../src/main/autobridge'
import { DEFAULT_AUTO_BRIDGE, type AutoBridgeConfig } from '../src/main/config/store'
import type { LastResponse, TransferState } from '../src/shared/types'

function setup(opts: { alive?: boolean; sendOk?: boolean } = {}) {
  let last: LastResponse | null = { messageId: 'm0', text: 'resposta antiga', generating: false, createdAt: null }
  let saved: AutoBridgeConfig = { ...DEFAULT_AUTO_BRIDGE }
  let clock = 1_000_000
  const sent: string[] = []
  let sendOk = opts.sendOk ?? true
  const deps = {
    claudeLast: () => last,
    claudeAlive: () => opts.alive ?? true,
    send: vi.fn(async (_c: string, text: string): Promise<TransferState> => {
      if (!sendOk) return { direction: 'claude-to-chatgpt', status: 'error', message: 'Navegador desconectado', at: 0 }
      sent.push(text)
      return { direction: 'claude-to-chatgpt', status: 'sent', message: 'ok', at: 0 }
    }),
    save: (c: AutoBridgeConfig) => (saved = c),
    now: () => clock
  }
  const b = new AutoBridge({ ...DEFAULT_AUTO_BRIDGE }, deps)
  return {
    b,
    sent,
    deps,
    saved: () => saved,
    respond: (id: string, text: string, generating = false) => (last = { messageId: id, text, generating, createdAt: null }),
    advance: (ms: number) => (clock += ms),
    setSendOk: (v: boolean) => (sendOk = v)
  }
}

const target = { sessionId: 's1', sessionTitle: 'Juiz', conversationId: 'c1', conversationTitle: 'Chat' }

describe('AutoBridge', () => {
  it('desligada não envia nada', async () => {
    const t = setup()
    t.respond('m1', 'nova')
    await t.b.tick()
    expect(t.sent).toHaveLength(0)
  })

  it('ao ligar ignora a resposta que já existia; envia só as novas, uma vez cada', async () => {
    const t = setup()
    t.b.enable(target)
    await t.b.tick()
    expect(t.sent).toHaveLength(0)
    t.respond('m1', 'primeira')
    await t.b.tick()
    await t.b.tick()
    t.respond('m2', 'segunda')
    await t.b.tick()
    expect(t.sent).toEqual(['primeira', 'segunda'])
  })

  it('não envia enquanto o Claude ainda está gerando (sem streaming)', async () => {
    const t = setup()
    t.b.enable(target)
    t.respond('m1', 'Portal Vist', true)
    await t.b.tick()
    expect(t.sent).toHaveLength(0)
    t.respond('m1', 'Portal Vistoria: pronto.')
    await t.b.tick()
    expect(t.sent).toEqual(['Portal Vistoria: pronto.'])
  })

  it('reinício do app não reenvia: o último ID tratado vem da configuração salva', async () => {
    const t = setup()
    t.b.enable(target)
    t.respond('m1', 'primeira')
    await t.b.tick()
    const b2 = new AutoBridge(t.saved(), t.deps)
    await b2.tick()
    expect(t.sent).toEqual(['primeira'])
  })

  it('sessão de origem fechada: não envia e mostra offline', async () => {
    const t = setup({ alive: false })
    t.b.enable(target)
    t.respond('m1', 'x')
    await t.b.tick()
    expect(t.sent).toHaveLength(0)
    expect(t.b.state().status).toBe('offline')
  })

  it('falha: tenta de novo com espera, para após 3x sem perder a resposta, e "Tentar de novo" envia uma vez', async () => {
    const t = setup({ sendOk: false })
    t.b.enable(target)
    t.respond('m1', 'importante')
    await t.b.tick()
    expect(t.b.state().status).toBe('error')
    await t.b.tick() // ainda dentro da espera: não tenta
    expect(t.deps.send).toHaveBeenCalledTimes(1)
    for (const d of RETRY_DELAYS_MS.slice(0, -1)) {
      t.advance(d)
      await t.b.tick()
    }
    expect(t.deps.send).toHaveBeenCalledTimes(3)
    t.advance(10 * 60 * 1000)
    await t.b.tick()
    expect(t.deps.send).toHaveBeenCalledTimes(3) // sem retries infinitos
    expect(t.b.state().pendingRetry).toBe(true)
    t.setSendOk(true)
    t.b.retry()
    await new Promise((r) => setTimeout(r, 0))
    expect(t.sent).toEqual(['importante'])
    await t.b.tick()
    expect(t.sent).toEqual(['importante'])
  })

  it('desligar para os envios', async () => {
    const t = setup()
    t.b.enable(target)
    t.b.disable()
    t.respond('m1', 'x')
    await t.b.tick()
    expect(t.sent).toHaveLength(0)
  })
})
