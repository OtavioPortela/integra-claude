import { describe, expect, it } from 'vitest'
import {
  detectTerminalApp,
  osaErrorMessage,
  parseTtyLine,
  sanitizePaste,
  sendScript,
  sendToMacTerminal,
  terminalAppFromCommand,
  type OsaRunner
} from '../src/main/integrations/claude/macos-terminals'
import { receiveStatus } from '../src/main/integrations/claude/adapter'

const TERMINAL = '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal'
const ITERM_SERVER = '/Applications/iTerm.app/Contents/MacOS/iTermServer-3.5.0'
const WARP = '/Applications/Warp.app/Contents/MacOS/stable'
const VSCODE = '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper'

describe('terminalAppFromCommand', () => {
  it('reconhece Terminal.app, iTerm2 e Warp', () => {
    expect(terminalAppFromCommand(TERMINAL)).toBe('terminal')
    expect(terminalAppFromCommand(ITERM_SERVER)).toBe('iterm')
    expect(terminalAppFromCommand('/Applications/iTerm2.app/Contents/MacOS/iTerm2')).toBe('iterm')
    expect(terminalAppFromCommand(WARP)).toBe('warp')
  })
  it('não confunde com outros programas', () => {
    expect(terminalAppFromCommand(VSCODE)).toBeNull()
    expect(terminalAppFromCommand('/bin/zsh')).toBeNull()
    expect(terminalAppFromCommand('-zsh')).toBeNull()
  })
})

describe('detectTerminalApp', () => {
  // claude(10) → zsh(9) → login(8) → Terminal(7) → launchd(1)
  const tree = new Map([[10, 9], [9, 8], [8, 7], [7, 1]])
  it('sobe pelos ancestrais até achar o app', () => {
    const cmds = new Map([[9, '-zsh'], [8, 'login'], [7, TERMINAL]])
    expect(detectTerminalApp(10, tree, cmds)).toBe('terminal')
  })
  it('sessão no VS Code não é tratada como Terminal.app', () => {
    const cmds = new Map([[9, '/bin/zsh'], [8, VSCODE], [7, '/Applications/Visual Studio Code.app/Contents/MacOS/Code']])
    expect(detectTerminalApp(10, tree, cmds)).toBeNull()
  })
  it('Warp é detectado (para explicar o "só leitura")', () => {
    expect(detectTerminalApp(10, tree, new Map([[7, WARP]]))).toBe('warp')
  })
})

describe('parseTtyLine', () => {
  it('lê TTY e primeiro plano', () => {
    expect(parseTtyLine('ttys000  S+ \n')).toEqual({ tty: '/dev/ttys000', foreground: true })
    expect(parseTtyLine('ttys012  T')).toEqual({ tty: '/dev/ttys012', foreground: false })
  })
  it('processo sem TTY não serve', () => {
    expect(parseTtyLine('??       S')).toBeNull()
    expect(parseTtyLine('')).toBeNull()
  })
})

describe('sanitizePaste', () => {
  it('remove marcadores de colagem embutidos no texto', () => {
    expect(sanitizePaste('a\x1b[201~b\x1b[200~c')).toBe('abc')
  })
})

describe('sendToMacTerminal', () => {
  it('passa TTY e texto por argv (nada interpolado no script)', async () => {
    const calls: { script: string; args: string[] }[] = []
    const run: OsaRunner = async (script, args) => {
      calls.push({ script, args })
      return 'ok'
    }
    const text = 'linha 1\n"aspas" & \\ end tell\nlinha 3'
    await sendToMacTerminal('terminal', '/dev/ttys004', text, run)
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual(['/dev/ttys004', text])
    expect(calls[0].script).not.toContain('linha 1')
    expect(calls[0].script).toContain('tty of t is wantTty')
    expect(calls[0].script).not.toMatch(/make new|activate|launch/)
  })
  it('iTerm2 cola sem Enter e depois envia o Enter', () => {
    const s = sendScript('iterm')
    expect(s).toContain('newline NO')
    expect(s.indexOf('newline NO')).toBeLessThan(s.indexOf('write text ""'))
  })
  it('Warp é recusado', () => {
    expect(() => sendScript('warp')).toThrow(/Warp/)
  })
  it('aba não encontrada vira erro', async () => {
    await expect(sendToMacTerminal('iterm', '/dev/ttys004', 'x', async () => 'notfound')).rejects.toThrow(/não encontrada no iTerm2/)
  })
  it('TTY inválido é recusado antes de chamar o osascript', async () => {
    let called = false
    const run: OsaRunner = async () => {
      called = true
      return 'ok'
    }
    await expect(sendToMacTerminal('terminal', '/dev/console', 'x', run)).rejects.toThrow(/TTY inválido/)
    expect(called).toBe(false)
  })
  it('falta de permissão de Automação vira mensagem clara', async () => {
    const run: OsaRunner = async () => {
      throw new Error('execution error: Not authorized to send Apple events to Terminal. (-1743)')
    }
    await expect(sendToMacTerminal('terminal', '/dev/ttys004', 'x', run)).rejects.toThrow(/Automação/)
    expect(osaErrorMessage('iterm', 'boom')).toMatch(/iTerm2: boom/)
  })
})

describe('receiveStatus', () => {
  const base = { inVscode: false, entrypoint: 'cli', vscodeConnected: true, macApp: null }
  it('VS Code, Terminal.app e iTerm2 recebem', () => {
    expect(receiveStatus({ ...base, inVscode: true }).canReceive).toBe(true)
    expect(receiveStatus({ ...base, macApp: 'terminal' })).toEqual({ canReceive: true, reason: null })
    expect(receiveStatus({ ...base, macApp: 'iterm', vscodeConnected: false }).canReceive).toBe(true)
  })
  it('Warp, Claude Desktop e terminais desconhecidos são só leitura', () => {
    expect(receiveStatus({ ...base, macApp: 'warp' }).reason).toMatch(/Warp/)
    expect(receiveStatus({ ...base, entrypoint: 'claude-desktop', macApp: 'terminal' }).canReceive).toBe(false)
    expect(receiveStatus(base).canReceive).toBe(false)
  })
})
