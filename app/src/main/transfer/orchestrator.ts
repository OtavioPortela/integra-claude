// Orquestra uma transferência: valida, monta o conteúdo, envia e confirma.
// Garante: um envio por vez por direção, sem duplicar, "Enviado" só com confirmação.
import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { Direction, TransferRequest, TransferState } from '../../shared/types'
import type { ChatGptAdapter, OutgoingFile } from '../integrations/chatgpt/adapter'
import type { ClaudeAdapter } from '../integrations/claude/adapter'
import { attachmentName, inlineFiles, mimeFor, readProjectFile } from '../files/project-files'

const CONFIRM_TIMEOUT_MS = 45000
const CONFIRM_POLL_MS = 1500

interface Attempt {
  key: string
  direction: Direction
  destId: string
  text: string
  sinceMs: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function composeForChatGpt(opts: {
  response: string | null
  project: string
  files: { relPath: string; content: string }[]
  mode: 'attach' | 'inline'
}): { text: string; attachments: OutgoingFile[] } {
  const parts: string[] = []
  if (opts.response) parts.push(opts.response)
  let attachments: OutgoingFile[] = []
  if (opts.files.length) {
    if (opts.mode === 'attach') {
      const list = opts.files.map((f) => `- ${f.relPath} (anexo: ${attachmentName(f.relPath)})`).join('\n')
      parts.push(`Arquivos do projeto "${opts.project}" anexados (versão atual em disco):\n${list}`)
      attachments = opts.files.map((f) => ({ name: attachmentName(f.relPath), content: f.content, mime: mimeFor(f.relPath) }))
    } else {
      parts.push(`Arquivos do projeto "${opts.project}" (versão atual em disco):\n\n${inlineFiles(opts.files as any)}`)
    }
  }
  return { text: parts.join('\n\n'), attachments }
}

export class TransferOrchestrator extends EventEmitter {
  private running = new Set<Direction>()
  private lastAttempt = new Map<Direction, Attempt>()
  private states = new Map<Direction, TransferState>()
  /** Conteúdos já confirmados por destino: evita reenvio acidental do mesmo conteúdo. */
  private sentLog = new Map<string, number>()
  private resendArmed = new Set<string>()

  constructor(private chat: ChatGptAdapter, private claude: ClaudeAdapter) {
    super()
  }

  state(direction: Direction): TransferState {
    return this.states.get(direction) ?? { direction, status: 'idle', message: '', at: Date.now() }
  }

  private set(direction: Direction, status: TransferState['status'], message: string): void {
    const s = { direction, status, message, at: Date.now() }
    this.states.set(direction, s)
    this.emit('state', s)
  }

  async run(req: TransferRequest): Promise<void> {
    const d = req.direction
    // Clique repetido enquanto um envio está em andamento: ignorado.
    if (this.running.has(d)) return
    this.running.add(d)
    try {
      const pending = this.lastAttempt.get(d)
      if (pending) {
        // Tentativa anterior sem confirmação: verifica antes de qualquer reenvio.
        this.set(d, 'confirming', 'Verificando a tentativa anterior antes de reenviar...')
        if (await this.delivered(pending)) {
          this.lastAttempt.delete(d)
          this.set(d, 'sent', 'Enviado (confirmado na verificação)')
          return
        }
        this.lastAttempt.delete(d)
        this.set(d, 'error', 'A tentativa anterior não chegou ao destino. Clique de novo para reenviar.')
        return
      }
      if (d === 'chatgpt-to-claude') await this.chatToClaude(req)
      else await this.claudeToChat(req)
    } catch (e: any) {
      this.set(d, 'error', String(e?.message || e))
    } finally {
      this.running.delete(d)
    }
  }

  private async delivered(a: Attempt): Promise<boolean> {
    if (a.direction === 'chatgpt-to-claude') return this.claude.isDelivered(a.destId, a.text, a.sinceMs)
    return (await this.chat.findSent(a.destId, a.text, a.sinceMs)) !== null
  }

  /**
   * Mesmo conteúdo já confirmado no mesmo destino: o primeiro clique só avisa;
   * um segundo clique explícito reenvia.
   */
  private guardResend(direction: Direction, destId: string, key: string): void {
    const k = `${direction}|${destId}|${key}`
    const at = this.sentLog.get(k)
    if (at && !this.resendArmed.has(k)) {
      this.resendArmed.add(k)
      const hora = new Date(at).toLocaleTimeString('pt-BR')
      throw new Error(`Este conteúdo já foi enviado para este destino às ${hora}. Clique de novo para reenviar mesmo assim.`)
    }
    this.resendArmed.delete(k)
  }

  private async confirm(a: Attempt): Promise<void> {
    this.lastAttempt.set(a.direction, a)
    this.set(a.direction, 'confirming', 'Enviado ao destino, aguardando confirmação...')
    const until = Date.now() + CONFIRM_TIMEOUT_MS
    while (Date.now() < until) {
      await sleep(CONFIRM_POLL_MS)
      try {
        if (await this.delivered(a)) {
          this.lastAttempt.delete(a.direction)
          this.sentLog.set(`${a.direction}|${a.destId}|${a.key}`, Date.now())
          this.set(a.direction, 'sent', 'Enviado ✓ (confirmado no destino)')
          return
        }
      } catch {}
    }
    this.set(a.direction, 'unconfirmed', 'Envio NÃO confirmado. Confira o destino; um novo clique verifica antes de reenviar.')
  }

  private async chatToClaude(req: TransferRequest): Promise<void> {
    const d = req.direction
    this.set(d, 'reading', 'Lendo a última resposta do ChatGPT...')
    const r = await this.chat.getLastResponse(req.conversationId)
    if (!r || (!r.text && !r.generating)) throw new Error('A conversa não tem resposta do ChatGPT para enviar')
    if (r.generating) throw new Error('Origem ainda gerando: aguarde o ChatGPT terminar')
    if (req.previewMessageId && r.messageId !== req.previewMessageId) {
      throw new Error('A resposta mudou desde a prévia. Confira a nova prévia e clique de novo.')
    }
    this.guardResend(d, req.sessionId, r.messageId)
    this.set(d, 'sending', 'Enviando para a sessão do Claude...')
    const { sinceMs } = await this.claude.send(req.sessionId, r.text)
    await this.confirm({ key: r.messageId, direction: d, destId: req.sessionId, text: r.text, sinceMs })
  }

  private async claudeToChat(req: TransferRequest): Promise<void> {
    const d = req.direction
    this.set(d, 'reading', 'Lendo a última resposta do Claude e os arquivos...')
    let response: string | null = null
    if (req.includeResponse) {
      const r = this.claude.getLastResponse(req.sessionId)
      if (!r) throw new Error('A sessão não tem resposta do Claude para enviar')
      if (r.generating) throw new Error('Origem ainda gerando: aguarde o Claude terminar o turno')
      if (req.previewMessageId && r.messageId !== req.previewMessageId) {
        throw new Error('A resposta mudou desde a prévia. Confira a nova prévia e clique de novo.')
      }
      response = r.text
    }
    const cwd = this.claude.sessionCwd(req.sessionId)
    if (req.files.length && !cwd) throw new Error('Diretório da sessão não encontrado')
    const files = req.files.map((f) => readProjectFile(cwd!, f)) // versão atual do disco
    if (!response && !files.length) throw new Error('Nada para enviar: marque a resposta ou arquivos')
    const { text, attachments } = composeForChatGpt({
      response,
      project: cwd ? path.basename(cwd) : '',
      files,
      mode: req.fileMode
    })
    this.guardResend(d, req.conversationId, text)
    this.set(d, 'sending', 'Verificando a conversa de destino...')
    if (await this.chat.isBusy(req.conversationId)) throw new Error('Destino ocupado: o ChatGPT está gerando nessa conversa')
    this.set(d, 'sending', attachments.length ? `Enviando com ${attachments.length} anexo(s)...` : 'Enviando para o ChatGPT...')
    const { sinceMs } = await this.chat.send(req.conversationId, text, attachments)
    await this.confirm({ key: text, direction: d, destId: req.conversationId, text, sinceMs })
  }
}
