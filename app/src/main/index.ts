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

transfers.on('state', (s) => send('transfer-state', s))
bridge.on('change', () => send('status', status()))

app.whenReady().then(async () => {
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
