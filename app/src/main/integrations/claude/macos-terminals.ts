// Envio para sessões abertas no Terminal.app e no iTerm2 (macOS), via AppleScript.
// A aba é localizada pelo TTY do processo `claude`, e o texto vai como colagem
// (bracketed paste) para que várias linhas virem UMA mensagem.
// Warp não tem dicionário AppleScript nem API para escrever numa aba existente: só leitura.
import { execFile, execFileSync } from 'node:child_process'
import { ancestors } from './sessions'

export type MacTerminalApp = 'terminal' | 'iterm' | 'warp'

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

/** Identifica o app de terminal pelo executável de um ancestral do processo `claude`. */
export function terminalAppFromCommand(command: string): MacTerminalApp | null {
  if (/\/Terminal\.app\/Contents\/MacOS\//.test(command)) return 'terminal'
  if (/\/iTerm2?\.app\/Contents\//.test(command)) return 'iterm'
  if (/\/Warp\.app\/Contents\/MacOS\//.test(command)) return 'warp'
  return null
}

/** Mapa pid → executável de todos os processos. */
export function processCommands(): Map<number, string> {
  const map = new Map<number, string>()
  try {
    const out = execFileSync('/bin/ps', ['-A', '-o', 'pid=,comm='], { encoding: 'utf8' })
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(.+)$/)
      if (m) map.set(Number(m[1]), m[2])
    }
  } catch {}
  return map
}

/** O primeiro ancestral que é um app de terminal conhecido decide o hospedeiro. */
export function detectTerminalApp(pid: number, tree: Map<number, number>, commands: Map<number, string>): MacTerminalApp | null {
  for (const a of ancestors(pid, tree)) {
    const app = terminalAppFromCommand(commands.get(a) ?? '')
    if (app) return app
  }
  return null
}

export interface TtyInfo {
  tty: string
  foreground: boolean
}

/** Saída de `ps -o tty=,stat=`: ex. "ttys000  S+". O "+" indica grupo em primeiro plano no TTY. */
export function parseTtyLine(line: string): TtyInfo | null {
  const m = line.trim().match(/^(ttys\d+)\s+(\S+)$/)
  if (!m) return null
  return { tty: `/dev/${m[1]}`, foreground: m[2].includes('+') }
}

export function ttyOf(pid: number): TtyInfo | null {
  try {
    return parseTtyLine(execFileSync('/bin/ps', ['-o', 'tty=,stat=', '-p', String(pid)], { encoding: 'utf8' }))
  } catch {
    return null
  }
}

/** Remove marcadores de colagem do próprio texto para ele não fechar a colagem antes da hora. */
export function sanitizePaste(text: string): string {
  return text.replace(/\x1b\[20[01]~/g, '')
}

// Os scripts recebem (tty, texto) por argv: nada do texto é interpolado no código.
// Retornam "ok" ou "notfound".
const TERMINAL_SCRIPT = `on run argv
  set wantTty to item 1 of argv
  set msg to item 2 of argv
  set esc to ASCII character 27
  tell application id "com.apple.Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is wantTty then
          -- do script digita o texto e um Enter no fim (que envia a mensagem)
          do script (esc & "[200~" & msg & esc & "[201~") in t
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "notfound"
end run`

const ITERM_SCRIPT = `on run argv
  set wantTty to item 1 of argv
  set msg to item 2 of argv
  set esc to ASCII character 27
  tell application id "com.googlecode.iterm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is wantTty then
            tell s to write text (esc & "[200~" & msg & esc & "[201~") newline NO
            delay 0.4
            tell s to write text ""
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "notfound"
end run`

export function sendScript(app: MacTerminalApp): string {
  if (app === 'terminal') return TERMINAL_SCRIPT
  if (app === 'iterm') return ITERM_SCRIPT
  throw new Error(WARP_REASON)
}

export const WARP_REASON = 'Sessão no Warp: só leitura (o Warp não permite escrever numa aba por automação)'

export const APP_LABEL: Record<MacTerminalApp, string> = { terminal: 'Terminal.app', iterm: 'iTerm2', warp: 'Warp' }

export type OsaRunner = (script: string, args: string[]) => Promise<string>

export const runOsascript: OsaRunner = (script, args) =>
  new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script, ...args], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message)))
      else resolve(String(stdout).trim())
    })
  })

/** Traduz falhas do osascript em mensagens para o usuário. */
export function osaErrorMessage(app: MacTerminalApp, raw: string): string {
  if (/-1743/.test(raw))
    return `Sem permissão para controlar o ${APP_LABEL[app]}: autorize em Ajustes do Sistema › Privacidade e Segurança › Automação`
  if (/-600|-1728/.test(raw)) return `${APP_LABEL[app]} não respondeu ou a aba sumiu`
  return `Falha ao escrever no ${APP_LABEL[app]}: ${raw.trim().slice(0, 200)}`
}

/** Escreve `text` como colagem + Enter na aba cujo TTY é `tty`. Nunca cria aba nem processo. */
export async function sendToMacTerminal(app: MacTerminalApp, tty: string, text: string, run: OsaRunner = runOsascript): Promise<void> {
  if (!/^\/dev\/ttys\d+$/.test(tty)) throw new Error('TTY inválido')
  const script = sendScript(app)
  let out: string
  try {
    out = await run(script, [tty, sanitizePaste(text)])
  } catch (e: any) {
    throw new Error(osaErrorMessage(app, String(e?.message ?? e)))
  }
  if (out !== 'ok') throw new Error(`Aba da sessão não encontrada no ${APP_LABEL[app]}`)
}
