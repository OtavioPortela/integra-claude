import type {
  AutoBridgeState,
  ChatConversationPage,
  ClaudeSessionList,
  ConnectionStatus,
  Direction,
  FilePreview,
  LastResponse,
  ProjectFileList,
  Selection,
  TransferRequest,
  TransferState
} from '../../shared/types'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

declare global {
  interface Window {
    integra: Record<string, (...args: any[]) => any>
  }
}

async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  const r: Result<T> = await window.integra[name](...args)
  if (!r.ok) throw new Error(r.error)
  return r.data
}

export const api = {
  status: () => call<ConnectionStatus & { error: string | null }>('status'),
  copyPairingCode: () => call<void>('copyPairingCode'),
  listConversations: (offset: number) => call<ChatConversationPage>('listConversations', offset),
  listSessions: (limit: number) => call<ClaudeSessionList>('listSessions', limit),
  chatLastResponse: (id: string) => call<LastResponse | null>('chatLastResponse', id),
  claudeLastResponse: (id: string) => call<LastResponse | null>('claudeLastResponse', id),
  listFiles: (sessionId: string) => call<ProjectFileList>('listFiles', sessionId),
  readFile: (sessionId: string, relPath: string) => call<FilePreview>('readFile', sessionId, relPath),
  transfer: (req: TransferRequest) => call<boolean>('transfer', req),
  transferState: (d: Direction) => call<TransferState>('transferState', d),
  getSelection: () => call<{ selection: Selection; fileMode: 'attach' | 'inline' }>('getSelection'),
  saveSelection: (s: Selection, fileMode: 'attach' | 'inline') => call<void>('saveSelection', s, fileMode),
  openTestSession: (cwd: string) => call<unknown>('openTestSession', cwd),
  autoBridgeState: () => call<AutoBridgeState>('autoBridgeState'),
  autoBridgeEnable: (o: { sessionId: string; sessionTitle: string; conversationId: string; conversationTitle: string }) =>
    call<AutoBridgeState>('autoBridgeEnable', o),
  autoBridgeDisable: () => call<AutoBridgeState>('autoBridgeDisable'),
  autoBridgeRetry: () => call<AutoBridgeState>('autoBridgeRetry'),
  on: (channel: 'status' | 'transfer-state' | 'auto-bridge', fn: (p: any) => void): (() => void) => window.integra.on(channel, fn)
}
