import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import path from 'node:path'
import { BridgeServer } from './bridge/server'
import { loadConfig, pairingCode, removeBridgeFile, saveConfig, writeBridgeFile } from './config/store'
import { ChatGptAdapter } from './integrations/chatgpt/adapter'
import { ClaudeAdapter } from './integrations/claude/adapter'
import { listProjectFiles, readProjectFile } from './files/project-files'
import { TransferOrchestrator } from './transfer/orchestrator'
import type { ConnectionStatus, Direction, Selection, TransferRequest } from '../shared/types'

const config = loadConfig()
const bridge = new BridgeServer(config.token)
const chat = new ChatGptAdapter(() => bridge.list('chrome').at(-1) ?? null)
const claude = new ClaudeAdapter(() => bridge.list('vscode'))
const transfers = new TransferOrchestrator(chat, claude)
let win: BrowserWindow | null = null
let bridgeError: string | null = null

function status(): ConnectionStatus & { error: string | null } {
  return {
    chrome: bridge.list('chrome').length > 0,
    vscode: bridge.list('vscode').length,
    pairingCode: pairingCode(config.port, config.token),
    port: config.port,
    error: bridgeError
  }
}

function send(channel: string, payload: unknown): void {
  win?.webContents.send(channel, payload)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'Integra Claude',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) }
    }
  })
}

handle('status', () => status())
handle('copyPairingCode', () => clipboard.writeText(status().pairingCode))
handle('listConversations', (offset: number) => chat.listConversations(offset))
handle('listSessions', (limit: number) => claude.listSessions(limit))
handle('chatLastResponse', (id: string) => chat.getLastResponse(id))
handle('claudeLastResponse', (id: string) => claude.getLastResponse(id))
handle('listFiles', (sessionId: string) => {
  const cwd = claude.sessionCwd(sessionId)
  if (!cwd) throw new Error('Diretório da sessão não encontrado')
  return listProjectFiles(cwd)
})
handle('readFile', (sessionId: string, relPath: string) => {
  const cwd = claude.sessionCwd(sessionId)
  if (!cwd) throw new Error('Diretório da sessão não encontrado')
  return readProjectFile(cwd, relPath)
})
handle('transfer', (req: TransferRequest) => {
  void transfers.run(req)
  return true
})
handle('transferState', (d: Direction) => transfers.state(d))
handle('getSelection', () => ({ selection: config.selection, fileMode: config.fileMode }))
handle('saveSelection', (selection: Selection, fileMode: 'attach' | 'inline') => {
  config.selection = selection
  config.fileMode = fileMode
  saveConfig(config)
})
handle('openTestSession', async (cwd: string) => {
  const vs = bridge.list('vscode')[0]
  if (!vs) throw new Error('Extensão do VS Code não conectada')
  return vs.call('openClaudeTerminal', { cwd }, 10000)
})

// ---- comandos do `integra` (terminal / skill do Claude Code) ----
async function waitChrome(): Promise<void> {
  for (let i = 0; i < 30 && !chat.connected(); i++) await new Promise((r) => setTimeout(r, 500))
  if (!chat.connected()) throw new Error('Navegador desconectado: abra o Chrome (extensão Integra Claude pareada)')
}
// Logo depois de abrir, a extensão do VS Code leva alguns segundos para reconectar.
async function waitVscode(): Promise<void> {
  for (let i = 0; i < 16 && bridge.list('vscode').length === 0; i++) await new Promise((r) => setTimeout(r, 500))
}
bridge.handleCli('status', () => status())
bridge.handleCli('conversations', async ({ offset = 0 }) => {
  await waitChrome()
  return chat.listConversations(Number(offset))
})
bridge.handleCli('chatLast', async ({ id }) => {
  await waitChrome()
  return chat.getLastResponse(String(id))
})
bridge.handleCli('sessions', async ({ limit = 10 }) => {
  await waitVscode()
  return claude.listSessions(Number(limit))
})
bridge.handleCli('claudeLast', ({ id }) => claude.getLastResponse(String(id)))
bridge.handleCli('sendChatGpt', async (p) => {
  await waitChrome()
  return transfers.sendCustom({ target: 'chatgpt', destId: String(p.id), text: String(p.text ?? ''), files: p.files ?? [], root: p.root, fileMode: p.fileMode, force: !!p.force })
})
bridge.handleCli('sendClaude', async (p) =>
  waitVscode().then(() => transfers.sendCustom({ target: 'claude', destId: String(p.id), text: String(p.text ?? ''), force: !!p.force }))
)

transfers.on('state', (s) => send('transfer-state', s))
bridge.on('change', () => send('status', status()))

app.whenReady().then(async () => {
  // Ícone no Dock (o app roda sem empacotar, então o bundle é o do Electron).
  app.dock?.setIcon(path.join(__dirname, '../../build/icon.png'))
  try {
    await bridge.listen(config.port)
    writeBridgeFile(config.port, config.token)
  } catch (e: any) {
    bridgeError = e?.code === 'EADDRINUSE' ? `Porta ${config.port} em uso (outra instância aberta?)` : String(e?.message || e)
  }
  createWindow()
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  bridge.close()
  removeBridgeFile()
})
