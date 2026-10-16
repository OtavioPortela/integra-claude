#!/usr/bin/env node
// integra — comando de terminal do Integra Claude.
// Fala com o app (WebSocket 127.0.0.1, token em ~/.integra-claude/bridge.json).
// Se o app estiver fechado, abre sozinho.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BRIDGE = path.join(os.homedir(), '.integra-claude', 'bridge.json')
const HERE = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))
const APP_DIR = path.resolve(HERE, '../app')
const LAUNCHER = path.join(os.homedir(), 'Desktop', 'Integra Claude.app')

const HELP = `integra — ponte ChatGPT ⇄ Claude Code

Uso:
  integra status                         conexões do app
  integra recarregar-chrome              recarrega a extensão do Chrome (após atualizar o projeto)
  integra conversas [--mais N]           lista conversas do ChatGPT (N = quantas já viu, p/ paginar)
  integra ler <idConversa>               última resposta do ChatGPT nessa conversa
  integra enviar-gpt <idConversa> [--arquivo caminho ...] [--modo anexar|texto] [--forcar]
                                         envia o texto da entrada padrão (stdin) ao ChatGPT;
                                         --arquivo: arquivo do projeto atual (relativo à pasta atual)
  integra sessoes                        lista sessões ativas do Claude Code
  integra ler-claude <idSessao>          última resposta de uma sessão do Claude
  integra enviar-claude <idSessao> [--forcar]
                                         envia o texto do stdin para outra sessão do Claude
  integra ponte                          estado da ponte automática Claude → ChatGPT
  integra ponte ligar <idSessao> <idConversa>   liga: cada resposta final da sessão vai sozinha para a conversa
  integra ponte desligar | tentar        desliga / tenta de novo após falhas
Opções: --json (saída em JSON)
Exemplo:
  integra enviar-gpt 6acf...a9 --arquivo specs/001/spec.md <<'EOF'
  Segue a especificação para revisão.
  EOF`

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const multi = (name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []))
const positional = args.filter((a, i) => !a.startsWith('--') && !['--mais', '--arquivo', '--modo'].includes(args[i - 1]))
const json = flag('--json')

function die(msg, code = 1) {
  console.error(`integra: ${msg}`)
  process.exit(code)
}

function readBridge() {
  try {
    return JSON.parse(fs.readFileSync(BRIDGE, 'utf8'))
  } catch {
    return null
  }
}

function openApp() {
  try {
    if (fs.existsSync(LAUNCHER)) execFileSync('/usr/bin/open', [LAUNCHER])
    else execFileSync('/usr/bin/open', ['-a', path.join(APP_DIR, 'node_modules/electron/dist/Electron.app'), '--args', APP_DIR])
  } catch (e) {
    die(`não consegui abrir o app: ${e.message}`)
  }
}

function connectOnce(bridge) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`)
    const t = setTimeout(() => {
      ws.close()
      reject(new Error('timeout'))
    }, 4000)
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role: 'cli', token: bridge.token, label: 'integra-cli' }))
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.type === 'welcome') {
        clearTimeout(t)
        resolve(ws)
      }
    }
    ws.onerror = () => {
      clearTimeout(t)
      reject(new Error('sem conexão'))
    }
    ws.onclose = (ev) => {
      clearTimeout(t)
      if (ev.code === 4003) reject(new Error('token recusado'))
    }
  })
}

async function connect() {
  let bridge = readBridge()
  if (bridge) {
    try {
      return await connectOnce(bridge)
    } catch (e) {
      if (e.message === 'token recusado') die('token recusado pelo app')
    }
  }
  if (!json) console.error('integra: abrindo o app Integra Claude...')
  openApp()
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 750))
    bridge = readBridge()
    if (!bridge) continue
    try {
      return await connectOnce(bridge)
    } catch {}
  }
  die('o app não respondeu. Abra "Integra Claude" na Mesa e tente de novo.')
}

function call(ws, method, params = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const t = setTimeout(() => reject(new Error(`tempo esgotado em ${method}`)), timeoutMs)
    ws.addEventListener('message', function onMsg(ev) {
      const m = JSON.parse(ev.data)
      if (m.type !== 'res' || m.id !== id) return
      clearTimeout(t)
      ws.removeEventListener('message', onMsg)
      m.ok ? resolve(m.result) : reject(new Error(m.error))
    })
    ws.send(JSON.stringify({ type: 'req', id, method, params }))
  })
}

async function stdinText() {
  if (process.stdin.isTTY) return ''
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

function printResult(state) {
  if (json) return console.log(JSON.stringify(state, null, 2))
  const icon = state.status === 'sent' ? '✅' : state.status === 'unconfirmed' ? '⚠️' : '❌'
  console.log(`${icon} ${state.message}`)
  if (state.status !== 'sent') process.exitCode = 2
}

async function main() {
  const [cmd, a1] = positional
  if (!cmd || flag('--help') || cmd === 'ajuda') return console.log(HELP)
  const ws = await connect()
  try {
    switch (cmd) {
      case 'status': {
        const s = await call(ws, 'status')
        if (json) return console.log(JSON.stringify(s, null, 2))
        console.log(`ChatGPT (Chrome): ${s.chrome ? 'conectado' : 'desconectado'} · VS Code: ${s.vscode} janela(s)`)
        break
      }
      case 'recarregar-chrome': {
        await call(ws, 'reloadChrome')
        console.log('✅ Extensão do Chrome recarregada e reconectada')
        break
      }
      case 'ponte': {
        const sub = a1 || 'status'
        const [, , sid, cid] = positional
        let st
        if (sub === 'ligar') {
          if (!sid || !cid) die('uso: integra ponte ligar <idSessao> <idConversa>')
          st = await call(ws, 'autoBridgeEnable', { sessionId: sid, conversationId: cid, sessionTitle: sid.slice(0, 8), conversationTitle: cid.slice(0, 8) })
        } else if (sub === 'desligar') st = await call(ws, 'autoBridgeDisable')
        else if (sub === 'tentar') st = await call(ws, 'autoBridgeRetry')
        else st = await call(ws, 'autoBridgeState')
        if (json) return console.log(JSON.stringify(st, null, 2))
        console.log(`Ponte automática: ${st.enabled ? 'ATIVA' : 'DESLIGADA'}`)
        if (st.enabled) console.log(`${st.sessionTitle} → ${st.conversationTitle}\n${st.message}`)
        break
      }
      case 'conversas': {
        const offset = Number(opt('--mais') || 0)
        const page = await call(ws, 'conversations', { offset })
        if (json) return console.log(JSON.stringify(page, null, 2))
        page.items.forEach((c, i) => console.log(`${String(offset + i + 1).padStart(2)}. ${c.title}  (${fmtDate(c.updatedAt)})  id=${c.id}`))
        console.log(page.hasMore ? `… há mais: integra conversas --mais ${offset + page.items.length}` : '(fim da lista)')
        break
      }
      case 'ler': {
        if (!a1) die('informe o id da conversa (veja: integra conversas)')
        const r = await call(ws, 'chatLast', { id: a1 })
        if (json) return console.log(JSON.stringify(r, null, 2))
        if (!r) die('a conversa não tem resposta do ChatGPT')
        if (r.generating) console.error('integra: atenção, o ChatGPT ainda está gerando esta resposta')
        console.log(r.text)
        break
      }
      case 'enviar-gpt': {
        if (!a1) die('informe o id da conversa (veja: integra conversas)')
        const text = await stdinText()
        const files = multi('--arquivo')
        if (!text.trim() && !files.length) die('nada para enviar: mande o texto pelo stdin e/ou use --arquivo')
        const modo = opt('--modo') === 'texto' ? 'inline' : 'attach'
        const r = await call(ws, 'sendChatGpt', { id: a1, text, files, root: process.cwd(), fileMode: modo, force: flag('--forcar') }, 180000)
        printResult(r)
        break
      }
      case 'sessoes': {
        const l = await call(ws, 'sessions', { limit: 0 })
        if (json) return console.log(JSON.stringify(l.active, null, 2))
        l.active.forEach((s, i) =>
          console.log(`${String(i + 1).padStart(2)}. ${s.title}  [${s.state === 'idle' ? 'ociosa' : 'trabalhando'}${s.canReceive ? '' : ', só leitura'}]  ${s.project}  id=${s.sessionId}`)
        )
        break
      }
      case 'ler-claude': {
        if (!a1) die('informe o id da sessão (veja: integra sessoes)')
        const r = await call(ws, 'claudeLast', { id: a1 })
        if (json) return console.log(JSON.stringify(r, null, 2))
        if (!r || !r.text) die('a sessão não tem resposta do Claude')
        console.log(r.text)
        break
      }
      case 'enviar-claude': {
        if (!a1) die('informe o id da sessão (veja: integra sessoes)')
        const text = await stdinText()
        if (!text.trim()) die('nada para enviar: mande o texto pelo stdin')
        printResult(await call(ws, 'sendClaude', { id: a1, text, force: flag('--forcar') }, 120000))
        break
      }
      default:
        die(`comando desconhecido: ${cmd}\n\n${HELP}`)
    }
  } catch (e) {
    die(e.message)
  } finally {
    ws.close()
  }
}

main()
