// Adaptador do ChatGPT: fala com a extensão do Chrome, que usa a sessão já logada do usuário.
// Leitura: endpoints internos da página (/backend-api). Envio: automação do campo de mensagem.
import type { BridgeClient } from '../../bridge/server'
import type { ChatConversationPage, LastResponse } from '../../../shared/types'
import { findUserMessage, lastAssistantResponse, type ChatConversationJson } from './extract'

export const PAGE_SIZE = 28

export interface OutgoingFile {
  name: string
  content: string
  mime: string
}

export class ChatGptAdapter {
  constructor(private chromeClient: () => BridgeClient | null) {}

  private client(): BridgeClient {
    const c = this.chromeClient()
    if (!c) throw new Error('Navegador desconectado: abra o Chrome com a extensão Integra Claude pareada')
    return c
  }

  connected(): boolean {
    return this.chromeClient() !== null
  }

  async listConversations(offset = 0): Promise<ChatConversationPage> {
    const r = await this.client().call<{ items: any[]; total?: number }>('listConversations', { offset, limit: PAGE_SIZE }, 30000)
    const items = (r.items ?? []).map((i) => ({ id: String(i.id), title: String(i.title || '(sem título)'), updatedAt: i.update_time ?? null }))
    // `total` do endpoint não é confiável; página cheia = provavelmente há mais.
    return { items, offset, hasMore: items.length >= PAGE_SIZE }
  }

  private cache = new Map<string, { at: number; p: Promise<ChatConversationJson> }>()
  private pausedUntil = 0

  /**
   * Lê a conversa com cache de 3 s (várias partes do app pedem a mesma conversa juntas)
   * e respeita a pausa pedida pelo ChatGPT (erro 429) para não piorar o bloqueio.
   */
  async getConversation(id: string, fresh = false): Promise<ChatConversationJson> {
    const wait = Math.ceil((this.pausedUntil - Date.now()) / 1000)
    if (wait > 0) throw new Error(`O ChatGPT pediu uma pausa (muitas leituras). Tente de novo em ${wait} s.`)
    const hit = this.cache.get(id)
    if (!fresh && hit && Date.now() - hit.at < 3000) return hit.p
    const p = this.client()
      .call<ChatConversationJson>('getConversation', { id }, 30000)
      .catch((e: Error) => {
        this.cache.delete(id)
        const m = /em (\d+) s/.exec(e.message)
        if (/pausa/.test(e.message)) this.pausedUntil = Date.now() + (m ? Number(m[1]) : 30) * 1000
        throw e
      })
    this.cache.set(id, { at: Date.now(), p })
    return p
  }

  async getLastResponse(id: string): Promise<LastResponse | null> {
    const c = await this.getConversation(id)
    const r = lastAssistantResponse(c)
    if (!r) return null
    return r
  }

  /** Destino ocupado = ainda gerando resposta (pela API ou pelo botão "parar" na aba aberta). */
  async isBusy(id: string): Promise<boolean> {
    const c = await this.getConversation(id)
    const r = lastAssistantResponse(c)
    if (r?.generating) return true
    const ui = await this.client().call<{ busy: boolean }>('composerState', { id }, 15000).catch(() => ({ busy: false }))
    return ui.busy
  }

  /** Cola anexos + texto na conversa e clica em enviar. Não confirma: veja findSent(). */
  async send(id: string, text: string, files: OutgoingFile[]): Promise<{ sinceMs: number }> {
    const sinceMs = Date.now()
    await this.client().call('sendMessage', { id, text, files }, 120000)
    return { sinceMs }
  }

  async findSent(id: string, text: string, sinceMs: number): Promise<string | null> {
    const c = await this.getConversation(id)
    return findUserMessage(c, text, sinceMs)
  }
}
