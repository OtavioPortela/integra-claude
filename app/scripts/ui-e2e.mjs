// Teste E2E pela interface real (Electron + extensões reais). Uso: node scripts/ui-e2e.mjs <outDir> [send]
import { _electron as electron } from 'playwright'
const out = process.argv[2]
const mode = process.argv[3] || ''
const doSend = mode === 'send' || mode === 'c2g'
const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1400, height: 900 })
const shot = (n) => win.screenshot({ path: `${out}/${n}.png` })
await win.waitForSelector('text=ChatGPT (Chrome): conectado', { timeout: 30000 })
await win.waitForSelector('text=VS Code: 1 janela(s)', { timeout: 30000 })
await win.getByText('Teste integra claude', { exact: true }).first().click()
await win.locator('.list li', { hasText: 'projeto-teste' }).first().click()
await win.waitForTimeout(4000)
await shot('01-selecionado')
if (doSend) {
  // marca specs/spec.md e envia Claude → ChatGPT
  await win.locator('.flist li', { hasText: 'specs/spec.md' }).locator('input').check()
  await win.waitForTimeout(800)
  await shot('02-arquivo-marcado')
  const toChat = win.getByRole('button', { name: /Claude → ChatGPT/ })
  await toChat.dblclick() // clique duplo proposital
  await win.waitForSelector('.tstate.sent, .tstate.error, .tstate.unconfirmed', { timeout: 120000 })
  await shot('03-claude-para-chatgpt')
  console.log('C->G:', await win.locator('.arrow').nth(1).locator('.tstate').innerText())
  if (mode === 'c2g') { await shot('04-final'); await app.close(); process.exit(0) }
  // espera o ChatGPT responder e envia ChatGPT → Claude
  await win.waitForTimeout(20000)
  await win.locator('.preview').first().getByRole('button', { name: 'Atualizar' }).click()
  await win.waitForTimeout(4000)
  const toClaude = win.getByRole('button', { name: /ChatGPT → Claude/ })
  console.log('bloqueio ChatGPT→Claude:', await win.locator('.arrow').nth(0).innerText())
  if (await toClaude.isEnabled()) {
    await toClaude.click()
    await win.locator('.arrow').nth(0).locator('.tstate.sent, .tstate.error, .tstate.unconfirmed').waitFor({ timeout: 120000 })
    console.log('G->C:', await win.locator('.arrow').nth(0).locator('.tstate').innerText())
  }
  await shot('04-final')
}
await app.close()
