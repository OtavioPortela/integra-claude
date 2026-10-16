// Configuração persistente em ~/.integra-claude (arquivos com permissão 600).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Selection } from '../../shared/types'

export const CONFIG_DIR = path.join(os.homedir(), '.integra-claude')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
/** Lido pela extensão do VS Code para achar o app. */
export const BRIDGE_FILE = path.join(CONFIG_DIR, 'bridge.json')

export const DEFAULT_PORT = 47821

export interface AutoBridgeConfig {
  enabled: boolean
  sessionId: string | null
  sessionTitle: string
  conversationId: string | null
  conversationTitle: string
  /** ID da última resposta do Claude já tratada (enviada ou ignorada ao ligar) */
  lastHandledMessageId: string | null
}

export const DEFAULT_AUTO_BRIDGE: AutoBridgeConfig = {
  enabled: false,
  sessionId: null,
  sessionTitle: '',
  conversationId: null,
  conversationTitle: '',
  lastHandledMessageId: null
}

export interface Config {
  token: string
  port: number
  selection: Selection
  fileMode: 'attach' | 'inline'
  autoBridge: AutoBridgeConfig
}

function writePrivate(file: string, data: unknown): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}

export function loadConfig(): Config {
  let cfg: Partial<Config> = {}
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {}
  const full: Config = {
    token: cfg.token && cfg.token.length >= 32 ? cfg.token : crypto.randomBytes(24).toString('hex'),
    port: cfg.port ?? DEFAULT_PORT,
    selection: cfg.selection ?? { conversationId: null, sessionId: null },
    fileMode: cfg.fileMode ?? 'attach',
    autoBridge: { ...DEFAULT_AUTO_BRIDGE, ...(cfg.autoBridge ?? {}) }
  }
  writePrivate(CONFIG_FILE, full)
  return full
}

export function saveConfig(cfg: Config): void {
  writePrivate(CONFIG_FILE, cfg)
}

export function writeBridgeFile(port: number, token: string): void {
  writePrivate(BRIDGE_FILE, { port, token, pid: process.pid })
}

export function removeBridgeFile(): void {
  try {
    fs.unlinkSync(BRIDGE_FILE)
  } catch {}
}

/** Código que o usuário cola uma vez na extensão do Chrome. */
export function pairingCode(port: number, token: string): string {
  return Buffer.from(JSON.stringify({ p: port, t: token })).toString('base64')
}
