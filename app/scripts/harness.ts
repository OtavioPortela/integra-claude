// Harness de integração real (sem interface): usa os mesmos módulos do app.
// Uso: npx tsx scripts/harness.ts <comando> [args]
import { BridgeServer } from '../src/main/bridge/server'
import { loadConfig, writeBridgeFile } from '../src/main/config/store'
import { ChatGptAdapter } from '../src/main/integrations/chatgpt/adapter'
import { ClaudeAdapter } from '../src/main/integrations/claude/adapter'
import { TransferOrchestrator } from '../src/main/transfer/orchestrator'

const cfg = loadConfig()
const bridge = new BridgeServer(cfg.token)
const chat = new ChatGptAdapter(() => bridge.list('chrome').at(-1) ?? null)
const claude = new ClaudeAdapter(() => bridge.list('vscode'))
const orch = new TransferOrchestrator(chat, claude)
orch.on('state', (s) => console.log(`[${s.direction}] ${s.status}: ${s.message}`))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await bridge.listen(cfg.port)
  writeBridgeFile(cfg.port, cfg.token)
  const need = process.argv[2]?.startsWith('chat') || process.argv[2] === 'transfer' ? ['chrome', 'vscode'] : ['vscode']
  for (let i = 0; i < 80 && need.some((r) => bridge.list(r as any).length === 0); i++) await sleep(500)
  console.log('clientes:', 'chrome', bridge.list('chrome').length, 'vscode', bridge.list('vscode').length)
  const [cmd, a, b, c] = process.argv.slice(2)
  if (cmd === 'sessions') {
    const l = await claude.listSessions(5)
    console.log(JSON.stringify(l.active.map((s) => ({ id: s.sessionId, t: s.title, cwd: s.cwd, st: s.state, recv: s.canReceive, why: s.receiveBlockedReason })), null, 1))
    console.log('historico:', l.history.length, 'mais:', l.historyHasMore)
  }
  if (cmd === 'open') console.log(await bridge.list('vscode')[0].call('openClaudeTerminal', { cwd: a }))
  if (cmd === 'claudeLast') console.log(JSON.stringify(claude.getLastResponse(a)))
  if (cmd === 'chatList') { const p = await chat.listConversations(Number(a || 0)); console.log(p.items.length, p.hasMore, p.items.slice(0, 3)) }
  if (cmd === 'chatLast') console.log(JSON.stringify(await chat.getLastResponse(a)))
  if (cmd === 'busyTests') {
    const conv = a, sess = b
    const req = (direction: any) => ({ direction, conversationId: conv, sessionId: sess, previewMessageId: null, includeResponse: true, files: [], fileMode: 'attach' as const })
    // 1) ChatGPT gerando -> ChatGPT→Claude deve bloquear
    await chat.send(conv, 'TESTE integra-claude: escreva uma lista numerada de 1 a 60, um item por linha, com o nome de uma fruta em cada.', [])
    await sleep(2500)
    await orch.run(req('chatgpt-to-claude'))
    console.log('ORIGEM GERANDO ->', orch.state('chatgpt-to-claude').message)
    await orch.run(req('claude-to-chatgpt'))
    console.log('DESTINO CHATGPT OCUPADO ->', orch.state('claude-to-chatgpt').message)
    // 2) Claude ocupado -> envio deve ser recusado
    await claude.send(sess, 'TESTE integra-claude: escreva um texto de uns 600 palavras sobre testes de software. Não use ferramentas.')
    await sleep(2500)
    console.log('status claude:', claude.liveRecord(sess)?.status)
    try { await claude.send(sess, 'não deveria chegar') ; console.log('FALHA: enviou') } catch (e: any) { console.log('DESTINO CLAUDE OCUPADO ->', e.message) }
    await orch.run(req('claude-to-chatgpt'))
    console.log('ORIGEM CLAUDE GERANDO ->', orch.state('claude-to-chatgpt').message)
  }
  if (cmd === 'transfer') {
    const [direction, conversationId, sessionId] = [a, b, c] as any
    const files = (process.argv[6] || '').split(',').filter(Boolean)
    const prev = direction === 'chatgpt-to-claude' ? await chat.getLastResponse(conversationId) : claude.getLastResponse(sessionId)
    const req = { direction, conversationId, sessionId, previewMessageId: prev?.messageId ?? null, includeResponse: process.argv[7] !== 'noresp', files, fileMode: (process.argv[8] as any) || 'attach' }
    // clique duplo proposital: o segundo deve ser ignorado
    await Promise.all([orch.run(req), orch.run(req)])
    console.log('FINAL:', orch.state(direction))
  }
  bridge.close()
  process.exit(0)
}
main().catch((e) => { console.error('ERRO', e); process.exit(1) })
