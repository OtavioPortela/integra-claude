// E2E real do envio para Terminal.app/iTerm2 (T033). Só aceita sessões em test-fixtures/.
// Uso: npx tsx scripts/terminal-e2e.mts <sessionId>
import { ClaudeAdapter } from '../src/main/integrations/claude/adapter'
const SID = process.argv[2]
const a = new ClaudeAdapter(() => [])
const list = await a.listSessions(0)
for (const s of list.active) console.log(s.project.padEnd(16), String(s.entrypoint).padEnd(15), s.canReceive, s.receiveBlockedReason ?? '')
const s = list.active.find((x) => x.sessionId === SID)
if (!s || !s.cwd.includes('/test-fixtures/')) throw new Error('Sessão de teste não encontrada (precisa estar em test-fixtures/)')
const text = `Teste T033 via adaptador (${new Date().toISOString()}): responda apenas OK2.\nLinha extra com "aspas" & \\ barra.`
const { sinceMs } = await a.send(SID, text)
for (let i = 0; i < 40; i++) {
  if (a.isDelivered(SID, text, sinceMs)) {
    console.log('ENTREGUE (confirmado no transcript)')
    process.exit(0)
  }
  await new Promise((r) => setTimeout(r, 250))
}
console.log('NÃO confirmado')
process.exit(1)
