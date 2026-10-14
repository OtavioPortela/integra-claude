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

  async getConversation(id: string): Promise<ChatConversationJson> {
    return this.client().call<ChatConversationJson>('getConversation', { id }, 30000)
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
