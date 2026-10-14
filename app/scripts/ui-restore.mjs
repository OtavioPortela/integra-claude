import { _electron as electron } from 'playwright'
const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const win = await app.firstWindow()
const t0 = Date.now()
await win.waitForSelector('text=ChatGPT (Chrome): conectado', { timeout: 60000 })
const tChrome = Date.now() - t0
await win.waitForSelector('.list li.sel', { timeout: 20000 })
await win.waitForTimeout(2000)
console.log('reconexão Chrome (ms):', tChrome)
console.log('selecionados:', await win.locator('.list li.sel .title').allInnerTexts())
console.log('pareamento pedido de novo?', await win.locator('text=cole o código').count() > 0)
await app.close()
