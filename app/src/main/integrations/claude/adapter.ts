// Adaptador do Claude Code: lista sessões, lê a última resposta e envia mensagens.
// Envio: digita no terminal integrado do VS Code onde a sessão está aberta
// (API documentada do VS Code: Terminal.processId + Terminal.sendText).
import path from 'node:path'
import type { BridgeClient } from '../../bridge/server'
import type { ClaudeSession, ClaudeSessionList, LastResponse } from '../../../shared/types'
import {
  ancestors,
  listHistoryFiles,
  processTree,
  quickInfo,
  readLiveSessionByPid,
  readLiveSessions,
  readTranscript,
  type LiveSessionRecord
} from './sessions'
import { findSentPrompt, lastResponse, sessionTitle } from './transcript'

export interface TerminalTarget {
  client: BridgeClient
  shellPid: number
}

interface VsTerminal {
  name: string
  shellPid: number | null
  exited: boolean
}

export class ClaudeAdapter {
  constructor(private vscodeClients: () => BridgeClient[]) {}

  private async terminalsByShellPid(): Promise<Map<number, TerminalTarget>> {
    const map = new Map<number, TerminalTarget>()
    await Promise.all(
      this.vscodeClients().map(async (client) => {
        try {
          const list = await client.call<VsTerminal[]>('listTerminals', {}, 5000)
          for (const t of list) if (t.shellPid && !t.exited) map.set(t.shellPid, { client, shellPid: t.shellPid })
        } catch {}
      })
    )
    return map
  }

  /** Acha o terminal do VS Code que contém o processo `claude` (algum ancestral é o shell). */
  async resolveTarget(pid: number): Promise<TerminalTarget | null> {
    const terms = await this.terminalsByShellPid()
    const tree = processTree()
    for (const a of ancestors(pid, tree)) {
      const t = terms.get(a)
      if (t) return t
    }
    return null
  }

  async listSessions(historyLimit = 30): Promise<ClaudeSessionList> {
    const live = readLiveSessions()
    const terms = await this.terminalsByShellPid()
    const tree = processTree()
    const liveIds = new Set(live.map((l) => l.sessionId))

    const active: ClaudeSession[] = live.map((rec) => {
      const inVscode = ancestors(rec.pid, tree).some((a) => terms.has(a))
      const entries = readTranscript(rec.sessionId)
      // Nome dado pelo usuário > título do transcript > nome automático do processo
      const userName = rec.nameSource === 'user' || rec.entrypoint === 'claude-desktop' ? rec.name?.trim() : ''
      const title = userName || sessionTitle(entries) || rec.name?.trim() || '(sem título)'
      let reason: string | null = null
      if (!inVscode) {
        reason =
          rec.entrypoint === 'claude-desktop'
            ? 'Sessão do app Claude Desktop: só leitura'
            : this.vscodeClients().length === 0
              ? 'Extensão do VS Code não conectada'
              : 'Não está num terminal do VS Code: só leitura'
      }
      return {
        sessionId: rec.sessionId,
        title,
        cwd: rec.cwd,
        project: path.basename(rec.cwd),
        updatedAt: rec.updatedAt ? new Date(rec.updatedAt).toISOString() : null,
        state: rec.status === 'idle' ? 'idle' : 'busy',
        active: true,
        entrypoint: rec.entrypoint ?? null,
        canReceive: inVscode,
        receiveBlockedReason: reason
      }
    })

    const hist = listHistoryFiles().filter((h) => !liveIds.has(h.sessionId))
    const history: ClaudeSession[] = hist.slice(0, historyLimit).map((h) => {
      const info = quickInfo(h.file)
      const cwd = info.cwd ?? ''
      return {
        sessionId: h.sessionId,
        title: info.title || '(sem título)',
        cwd,
        project: cwd ? path.basename(cwd) : '?',
        updatedAt: new Date(h.mtimeMs).toISOString(),
        state: 'history',
        active: false,
        entrypoint: null,
        canReceive: false,
        receiveBlockedReason: 'Sessão encerrada (histórico): só leitura'
      }
    })
    return { active, history, historyHasMore: hist.length > historyLimit }
  }

  liveRecord(sessionId: string): LiveSessionRecord | null {
    return readLiveSessions().find((r) => r.sessionId === sessionId) ?? null
  }

  sessionCwd(sessionId: string): string | null {
    const live = this.liveRecord(sessionId)
    if (live) return live.cwd
    const entries = readTranscript(sessionId)
    const e = entries.find((x) => typeof (x as any).cwd === 'string')
    return e ? String((e as any).cwd) : null
  }

  getLastResponse(sessionId: string): LastResponse | null {
    const r = lastResponse(readTranscript(sessionId))
    const live = this.liveRecord(sessionId)
    const busy = live ? live.status !== 'idle' : false
    if (!r) return busy ? { messageId: '', text: '', generating: true, createdAt: null } : null
    return { messageId: r.messageId, text: r.text, generating: busy || !r.complete, createdAt: r.createdAt }
  }

  /**
   * Envia `text` como mensagem do usuário. Revalida a identidade logo antes de digitar:
   * o processo ainda existe, continua com o MESMO sessionId e está ocioso.
   */
  async send(sessionId: string, text: string): Promise<{ sinceMs: number }> {
    const rec = this.liveRecord(sessionId)
    if (!rec) throw new Error('Sessão indisponível: não há processo do Claude Code com esse ID')
    const fresh = readLiveSessionByPid(rec.pid)
    if (!fresh || fresh.sessionId !== sessionId) throw new Error('A sessão mudou de ID (ex.: /clear). Atualize a lista.')
    if (fresh.status !== 'idle') throw new Error('Destino ocupado: o Claude está trabalhando')
    const target = await this.resolveTarget(rec.pid)
    if (!target) throw new Error('Sessão não está num terminal do VS Code conectado: só leitura')
    const sinceMs = Date.now()
    await target.client.call('sendText', { shellPid: target.shellPid, text }, 10000)
    return { sinceMs }
  }

  /** Confirmação observável: a mensagem aparece no transcript da sessão. */
  isDelivered(sessionId: string, text: string, sinceMs: number): boolean {
    return findSentPrompt(readTranscript(sessionId), text, sinceMs)
  }
}
