import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api = {
  status: () => invoke('status'),
  copyPairingCode: () => invoke('copyPairingCode'),
  listConversations: (offset: number) => invoke('listConversations', offset),
  listSessions: (limit: number) => invoke('listSessions', limit),
  chatLastResponse: (id: string) => invoke('chatLastResponse', id),
  claudeLastResponse: (id: string) => invoke('claudeLastResponse', id),
  listFiles: (sessionId: string) => invoke('listFiles', sessionId),
  readFile: (sessionId: string, relPath: string) => invoke('readFile', sessionId, relPath),
  transfer: (req: unknown) => invoke('transfer', req),
  transferState: (d: string) => invoke('transferState', d),
  getSelection: () => invoke('getSelection'),
  saveSelection: (sel: unknown, fileMode: string) => invoke('saveSelection', sel, fileMode),
  openTestSession: (cwd: string) => invoke('openTestSession', cwd),
  autoBridgeState: () => invoke('autoBridgeState'),
  autoBridgeEnable: (o: unknown) => invoke('autoBridgeEnable', o),
  autoBridgeDisable: () => invoke('autoBridgeDisable'),
  autoBridgeRetry: () => invoke('autoBridgeRetry'),
  on: (channel: 'status' | 'transfer-state' | 'auto-bridge', fn: (payload: any) => void) => {
    const listener = (_e: unknown, payload: unknown) => fn(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('integra', api)

export type IntegraApi = typeof api
