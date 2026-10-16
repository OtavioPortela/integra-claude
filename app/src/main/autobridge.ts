// Ponte automática (opcional): resposta final de UMA sessão do Claude → UMA conversa do ChatGPT.
// - Só nesse sentido: nada volta automaticamente do ChatGPT para o Claude (sem loop).
// - Só a resposta final do turno (sessão ociosa e turno concluído), nunca streaming.
// - Cada resposta é identificada pelo ID da mensagem do Claude; o último ID tratado fica salvo
//   em disco, então reiniciar o app não reenvia nada.
// - Falha: até 3 tentativas com espera crescente; depois fica parada aguardando "Tentar de novo".
import { EventEmitter } from 'node:events'
import type { AutoBridgeConfig } from './config/store'
import type { AutoBridgeState, LastResponse, TransferState } from '../shared/types'

export interface AutoBridgeDeps {
  claudeLast(sessionId: string): LastResponse | null
  claudeAlive(sessionId: string): boolean
  send(conversationId: string, text: string): Promise<TransferState>
  save(cfg: AutoBridgeConfig): void
  now?: () => number
}

export const POLL_MS = 3000
export const RETRY_DELAYS_MS = [15000, 60000, 180000]

const WATCHING = 'Aguardando a próxima resposta do Claude'

export class AutoBridge extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private status: AutoBridgeState['status'] = 'off'
  private message = ''
  private lastSentAt: number | null = null
  private failures = 0
  private nextTryAt = 0

  constructor(private cfg: AutoBridgeConfig, private deps: AutoBridgeDeps) {
    super()
    if (cfg.enabled) {
      this.status = 'watching'
      this.message = WATCHING
    }
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  state(): AutoBridgeState {
    return {
      enabled: this.cfg.enabled,
      status: this.cfg.enabled ? this.status : 'off',
      message: this.cfg.enabled ? this.message : 'Desligada',
      sessionId: this.cfg.sessionId,
      sessionTitle: this.cfg.sessionTitle,
      conversationId: this.cfg.conversationId,
      conversationTitle: this.cfg.conversationTitle,
      lastSentAt: this.lastSentAt,
      pendingRetry: this.failures >= RETRY_DELAYS_MS.length
    }
  }

  private set(status: AutoBridgeState['status'], message: string): void {
    this.status = status
    this.message = message
    this.emit('state', this.state())
  }

  start(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => void this.tick(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Liga a ponte. A resposta que já existe na sessão é marcada como tratada:
   * só respostas NOVAS (depois de ligar) são enviadas.
   */
  enable(o: { sessionId: string; sessionTitle: string; conversationId: string; conversationTitle: string }): AutoBridgeState {
    const current = this.deps.claudeLast(o.sessionId)
    this.cfg = { enabled: true, ...o, lastHandledMessageId: current?.messageId || null }
    this.failures = 0
    this.nextTryAt = 0
    this.deps.save(this.cfg)
    this.set('watching', WATCHING)
    return this.state()
  }

  disable(): AutoBridgeState {
    this.cfg = { ...this.cfg, enabled: false }
    this.failures = 0
    this.deps.save(this.cfg)
    this.set('off', 'Desligada')
    return this.state()
  }

  /** Depois de esgotar as tentativas: tenta de novo a mesma resposta (ela não foi confirmada, não duplica). */
  retry(): AutoBridgeState {
    this.failures = 0
    this.nextTryAt = 0
    this.set('watching', 'Tentando de novo...')
    void this.tick()
    return this.state()
  }

  async tick(): Promise<void> {
    if (this.busy || !this.cfg.enabled || !this.cfg.sessionId || !this.cfg.conversationId) return
    if (this.failures >= RETRY_DELAYS_MS.length || this.now() < this.nextTryAt) return
    const { sessionId, conversationId } = this.cfg
    // Origem pelo ID real da sessão: se ela não está viva, não procura sessões "parecidas".
    if (!this.deps.claudeAlive(sessionId)) {
      if (this.status !== 'offline') this.set('offline', 'Sessão de origem fechada: reabra a mesma sessão (claude --resume) ou escolha outra')
      return
    }
    if (this.status === 'offline') this.set('watching', WATCHING)
    const r = this.deps.claudeLast(sessionId)
    if (!r || !r.messageId || !r.text.trim() || r.generating) return
    if (r.messageId === this.cfg.lastHandledMessageId) return

    this.busy = true
    try {
      this.set('sending', 'Enviando a nova resposta do Claude ao ChatGPT...')
      const st = await this.deps.send(conversationId, r.text)
      if (st.status !== 'sent') throw new Error(st.message || 'Envio não confirmado')
      // Só marca como tratada depois da confirmação: falha nunca "perde" a resposta.
      this.cfg = { ...this.cfg, lastHandledMessageId: r.messageId }
      this.deps.save(this.cfg)
      this.lastSentAt = this.now()
      this.failures = 0
      this.set('watching', `Enviado ✓ ${new Date(this.lastSentAt).toLocaleTimeString('pt-BR')} · ${WATCHING.toLowerCase()}`)
    } catch (e: any) {
      this.failures++
      const msg = String(e?.message || e)
      if (this.failures >= RETRY_DELAYS_MS.length) {
        this.set('error', `Falhou ${this.failures}x: ${msg}. A resposta não foi perdida: clique em "Tentar de novo".`)
      } else {
        const wait = RETRY_DELAYS_MS[this.failures - 1]
        this.nextTryAt = this.now() + wait
        this.set('error', `${msg}. Nova tentativa em ${Math.round(wait / 1000)} s (${this.failures}/${RETRY_DELAYS_MS.length}).`)
      }
    } finally {
      this.busy = false
    }
  }
}
