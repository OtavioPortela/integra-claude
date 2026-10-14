import { BridgeServer } from '../src/main/bridge/server'
import { loadConfig, writeBridgeFile } from '../src/main/config/store'
const cfg = loadConfig(); const b = new BridgeServer(cfg.token)
;(async () => { await b.listen(cfg.port); writeBridgeFile(cfg.port, cfg.token)
  for (let i = 0; i < 200 && !b.list('chrome').length; i++) await new Promise((r) => setTimeout(r, 250))
  console.log('chrome clientes:', b.list('chrome').length)
  try { console.log(await b.list('chrome').at(-1)!.call(process.argv[2], JSON.parse(process.argv[3] || '{}'))) } catch (e: any) { console.log('ERRO', e.message) }
  b.close(); process.exit(0) })()
