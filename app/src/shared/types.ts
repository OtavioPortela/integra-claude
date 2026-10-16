// Tipos compartilhados entre o processo principal e a interface.

export type Direction = 'chatgpt-to-claude' | 'claude-to-chatgpt'

export interface ChatConversation {
  id: string
  title: string
  updatedAt: string | null
}

export interface ChatConversationPage {
  items: ChatConversation[]
  offset: number
  hasMore: boolean
}

export type SessionState = 'idle' | 'busy' | 'history'

export interface ClaudeSession {
  sessionId: string
  title: string
  cwd: string
  project: string
  updatedAt: string | null
  state: SessionState
  /** active = processo vivo; history = só transcript em disco */
  active: boolean
  /** Origem do processo: cli, claude-desktop, etc. */
  entrypoint: string | null
  /** Pode receber mensagens (está num terminal do VS Code conectado) */
  canReceive: boolean
  /** Motivo quando não pode receber */
  receiveBlockedReason: string | null
}

export interface ClaudeSessionList {
  active: ClaudeSession[]
  history: ClaudeSession[]
  historyHasMore: boolean
}

export interface LastResponse {
  /** ID estável da mensagem de origem (para detectar mudança entre prévia e envio) */
  messageId: string
  text: string
  /** A origem ainda está gerando */
  generating: boolean
  createdAt: string | null
}

export interface ProjectFile {
  relPath: string
  size: number
  mtimeMs: number
  blocked: string | null
}

export interface ProjectFileList {
  root: string
  files: ProjectFile[]
  truncated: boolean
}

export interface FilePreview {
  relPath: string
  content: string
  size: number
}

export type TransferStatus =
  | 'idle'
  | 'reading'
  | 'sending'
  | 'confirming'
  | 'sent'
  | 'unconfirmed'
  | 'error'

export interface TransferState {
  direction: Direction
  status: TransferStatus
  message: string
  at: number
}

export interface TransferRequest {
  direction: Direction
  conversationId: string
  sessionId: string
  /** ID da mensagem mostrada na prévia; se mudou, o envio é recusado */
  previewMessageId: string | null
  includeResponse: boolean
  files: string[]
  fileMode: 'attach' | 'inline'
}

export interface ConnectionStatus {
  chrome: boolean
  vscode: number
  pairingCode: string
  port: number
}

export interface Selection {
  conversationId: string | null
  sessionId: string | null
}

export type AutoBridgeStatus = 'off' | 'watching' | 'sending' | 'error' | 'offline'

export interface AutoBridgeState {
  enabled: boolean
  status: AutoBridgeStatus
  message: string
  sessionId: string | null
  sessionTitle: string
  conversationId: string | null
  conversationTitle: string
  lastSentAt: number | null
  pendingRetry: boolean
}
