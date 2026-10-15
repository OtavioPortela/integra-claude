// Adaptador do Claude Code: lista sessões, lê a última resposta e envia mensagens.
// Envio: digita no terminal integrado do VS Code onde a sessão está aberta
// (API documentada do VS Code: Terminal.processId + Terminal.sendText) ou, no macOS,
// na aba do Terminal.app/iTerm2 que tem o TTY do processo (AppleScript, macos-terminals.ts).
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
import {
  APP_LABEL,
  WARP_REASON,
  detectTerminalApp,
  processCommands,
  sendToMacTerminal,
  ttyOf,
  type MacTerminalApp
} from './macos-terminals'

export interface TerminalTarget {
  client: BridgeClient
  shellPid: number
}

interface VsTerminal {
  name: string
  shellPid: number | null
  exited: boolean
}

/** Decide se a sessão pode receber mensagens e, se não, por quê. */
export function receiveStatus(o: {
  inVscode: boolean
  entrypoint?: string
  vscodeConnected: boolean
  macApp: MacTerminalApp | null
}): { canReceive: boolean; reason: string | null } {
  if (o.inVscode) return { canReceive: true, reason: null }
  if (o.entrypoint === 'claude-desktop') return { canReceive: false, reason: 'Sessão do app Claude Desktop: só leitura' }
  if (o.macApp === 'terminal' || o.macApp === 'iterm') return { canReceive: true, reason: null }
  if (o.macApp === 'warp') return { canReceive: false, reason: WARP_REASON }
  return {
    canReceive: false,
    reason: o.vscodeConnected
      ? 'Não está num terminal do VS Code, Terminal.app ou iTerm2: só leitura'
      : 'Extensão do VS Code não conectada e sessão fora do Terminal.app/iTerm2'
  }
}

const isMac = process.platform === 'darwin'

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
    const commands = isMac ? processCommands() : new Map<number, string>()
    const liveIds = new Set(live.map((l) => l.sessionId))

    const active: ClaudeSession[] = live.map((rec) => {
      const inVscode = ancestors(rec.pid, tree).some((a) => terms.has(a))
      const entries = readTranscript(rec.sessionId)
      // Nome dado pelo usuário > título do transcript > nome automático do processo
      const userName = rec.nameSource === 'user' || rec.entrypoint === 'claude-desktop' ? rec.name?.trim() : ''
      const title = userName || sessionTitle(entries) || rec.name?.trim() || '(sem título)'
      const { canReceive, reason } = receiveStatus({
        inVscode,
        entrypoint: rec.entrypoint,
        vscodeConnected: this.vscodeClients().length > 0,
        macApp: inVscode || !isMac ? null : detectTerminalApp(rec.pid, tree, commands)
      })
      return {
        sessionId: rec.sessionId,
        title,
        cwd: rec.cwd,
        project: path.basename(rec.cwd),
        updatedAt: rec.updatedAt ? new Date(rec.updatedAt).toISOString() : null,
        state: rec.status === 'idle' ? 'idle' : 'busy',
        active: true,
        entrypoint: rec.entrypoint ?? null,
        canReceive,
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
    if (target) {
      const sinceMs = Date.now()
      await target.client.call('sendText', { shellPid: target.shellPid, text }, 10000)
      return { sinceMs }
    }
    const app = isMac && rec.entrypoint !== 'claude-desktop' ? detectTerminalApp(rec.pid, processTree(), processCommands()) : null
    if (app !== 'terminal' && app !== 'iterm') {
      throw new Error(app === 'warp' ? WARP_REASON : 'Sessão não está num terminal do VS Code, Terminal.app ou iTerm2: só leitura')
    }
    // O `claude` precisa estar em primeiro plano no TTY: senão o texto iria para outro programa.
    const tty = ttyOf(rec.pid)
    if (!tty) throw new Error('Não foi possível achar o TTY da sessão')
    if (!tty.foreground) throw new Error(`O Claude não está em primeiro plano na aba do ${APP_LABEL[app]}`)
    // Revalida logo antes de escrever: mesmo processo, mesmo sessionId, ainda ocioso.
    const again = readLiveSessionByPid(rec.pid)
    if (!again || again.sessionId !== sessionId) throw new Error('A sessão mudou de ID (ex.: /clear). Atualize a lista.')
    if (again.status !== 'idle') throw new Error('Destino ocupado: o Claude está trabalhando')
    const sinceMs = Date.now()
    await sendToMacTerminal(app, tty.tty, text)
    return { sinceMs }
  }

  /** Confirmação observável: a mensagem aparece no transcript da sessão. */
  isDelivered(sessionId: string, text: string, sinceMs: number): boolean {
    return findSentPrompt(readTranscript(sessionId), text, sinceMs)
  }
}
