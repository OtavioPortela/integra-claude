# Contrato: protocolo local (WebSocket `ws://127.0.0.1:47821`)

Mensagens em JSON.

## Handshake (cliente → app)

```json
{ "type": "hello", "role": "chrome" | "vscode", "token": "<token>", "clientId": "...", "label": "..." }
```

- Token errado: o app fecha com código `4003`. Sem hello em 5 s: fecha com `4001`.
- Origin diferente de `chrome-extension://flkhnafholknnhekibjideljokgjencm` (quando presente): o handshake HTTP é recusado.
- Sucesso: `{ "type": "welcome" }`. O app manda `{ "type": "ping" }` a cada 20 s.

## Chamadas (app → cliente)

`{ "type": "req", "id": "<uuid>", "method": "...", "params": {...} }`
→ `{ "type": "res", "id": "<uuid>", "ok": true, "result": ... }` ou `{ "ok": false, "error": "..." }`

### Chrome

| method | params | result |
|---|---|---|
| `status` | — | `{ chatgptTabs }` |
| `listConversations` | `{ offset, limit }` | JSON bruto de `/backend-api/conversations` |
| `getConversation` | `{ id }` | JSON bruto de `/backend-api/conversation/<id>` |
| `composerState` | `{ id }` | `{ busy, open }` |
| `sendMessage` | `{ id, text, files: [{ name, content, mime }] }` | `{ clicked: true }`, ou erro sem enviar nada |

### VS Code

| method | params | result |
|---|---|---|
| `listTerminals` | — | `[{ name, shellPid, exited }]` |
| `sendText` | `{ shellPid, text }` | `{ delivered: true }` (texto digitado, ainda sem confirmação) |
| `openClaudeTerminal` | `{ cwd }` | `{ shellPid }` (só para sessões de teste) |

## Eventos (cliente → app)

`{ "type": "event", "name": "terminalsChanged" }`
