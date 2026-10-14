import { describe, expect, it, vi } from 'vitest'
import { TransferOrchestrator } from '../src/main/transfer/orchestrator'

// Adaptadores falsos: só para testar as regras do orquestrador (a integração real é testada à parte).
function setup(opts: { delivered?: boolean; generating?: boolean; claudeBusy?: string | null } = {}) {
  const sent: string[] = []
  const chat: any = {
    getLastResponse: vi.fn(async () => ({ messageId: 'm1', text: 'resposta', generating: !!opts.generating, createdAt: null }))
  }
  const claude: any = {
    send: vi.fn(async (_id: string, text: string) => {
      if (opts.claudeBusy) throw new Error(opts.claudeBusy)
      sent.push(text)
      return { sinceMs: Date.now() }
    }),
    isDelivered: vi.fn(() => opts.delivered ?? true)
  }
  const o = new TransferOrchestrator(chat, claude)
  const req = { direction: 'chatgpt-to-claude' as const, conversationId: 'c', sessionId: 's', previewMessageId: 'm1', includeResponse: true, files: [], fileMode: 'attach' as const }
  return { o, req, sent, claude }
}

describe('TransferOrchestrator', () => {
  it('clique duplo envia uma vez só', async () => {
    const { o, req, sent } = setup()
    await Promise.all([o.run(req), o.run(req), o.run(req)])
    expect(sent).toHaveLength(1)
    expect(o.state('chatgpt-to-claude').status).toBe('sent')
  }, 10000)

  it('mesmo conteúdo no mesmo destino: avisa antes, reenvia no clique seguinte', async () => {
    const { o, req, sent } = setup()
    await o.run(req)
    await o.run(req)
    expect(sent).toHaveLength(1)
    expect(o.state('chatgpt-to-claude').message).toMatch(/já foi enviado/)
    await o.run(req)
    expect(sent).toHaveLength(2)
  }, 15000)

  it('bloqueia quando a origem está gerando', async () => {
    const { o, req, sent } = setup({ generating: true })
    await o.run(req)
    expect(sent).toHaveLength(0)
    expect(o.state('chatgpt-to-claude').message).toMatch(/gerando/)
  })

  it('bloqueia quando a prévia mudou', async () => {
    const { o, req, sent } = setup()
    await o.run({ ...req, previewMessageId: 'outro' })
    expect(sent).toHaveLength(0)
    expect(o.state('chatgpt-to-claude').message).toMatch(/mudou/)
  })

  it('repassa "destino ocupado" sem enviar', async () => {
    const { o, req, sent } = setup({ claudeBusy: 'Destino ocupado: o Claude está trabalhando' })
    await o.run(req)
    expect(sent).toHaveLength(0)
    expect(o.state('chatgpt-to-claude').status).toBe('error')
  })

  it('sem confirmação: fica "não confirmado" e verifica antes de reenviar', async () => {
    vi.useFakeTimers()
    const { o, req, sent, claude } = setup({ delivered: false })
    const p = o.run(req)
    await vi.advanceTimersByTimeAsync(60000)
    await p
    expect(o.state('chatgpt-to-claude').status).toBe('unconfirmed')
    // chegou atrasado: o próximo clique só verifica e marca enviado, sem reenviar
    claude.isDelivered.mockReturnValue(true)
    await o.run(req)
    expect(sent).toHaveLength(1)
    expect(o.state('chatgpt-to-claude').status).toBe('sent')
    vi.useRealTimers()
  })
})
