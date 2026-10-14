# Research: Ponte ChatGPT ↔ Claude Code

Experimentos feitos em 2026-10-14 no Mac do usuário (macOS 15.7.4, Chrome, VS Code 1.138,
Claude Code 2.1.299), usando só a conversa de teste "Teste integra claude" e a sessão de teste
em `test-fixtures/projeto-teste`.

## Resultado das hipóteses

| # | Hipótese | Resultado | Como |
|---|---|---|---|
| H1 | Listar conversas com paginação | ✅ Comprovada | `GET /backend-api/conversations?offset&limit&order=updated` com token de `/api/auth/session`, executado dentro de chatgpt.com. `total` não é confiável: "há mais" = página cheia |
| H2 | Ler a última resposta concluída | ✅ Comprovada | `GET /backend-api/conversation/<id>`: segue `current_node` → raiz; resposta final = mensagem `assistant`, `text`, `recipient=all`, `end_turn=true`. Ignora `thoughts`, `reasoning_recap` e ferramentas |
| H3 | Enviar na mesma conversa | ✅ Comprovada | Evento `paste` no editor ProseMirror + clique no `button[type=submit]` do formulário. Texto com várias linhas e bloco de código chegou idêntico |
| H4 | Anexo real de arquivo | ✅ Comprovada | `paste` com `DataTransfer` contendo `File`. O ChatGPT leu o conteúdo do `.md` anexado ("ABACAXI-42", depois "MANGA-7") |
| H5 | Descobrir sessões do Claude e o diretório | ✅ Comprovada (formato interno) | `~/.claude/sessions/<pid>.json` (sessionId, cwd, status, nome, entrypoint) + `~/.claude/projects/*/<sessionId>.jsonl` |
| H6 | Ler a última resposta do Claude | ✅ Comprovada (formato interno) | JSONL: blocos `text` do assistente depois do último resultado de ferramenta; fim de turno = `system/turn_duration` ou `stop_reason=end_turn` |
| H7 | Enviar para uma sessão já aberta | ✅ Comprovada **para terminais do VS Code** | Extensão do VS Code: `Terminal.processId` (PID do shell) ↔ ancestral do processo `claude`; `sendText` com bracketed paste + Enter. A mensagem aparece no transcript como mensagem do usuário |
| H8 | Saber se a sessão está ocupada | ✅ Comprovada (formato interno) | Campo `status` (`idle`/`busy`) em `~/.claude/sessions/<pid>.json` |

## Decisões

### D1: Comunicação extensão ↔ app: WebSocket local (e não Native Messaging)
- **Decisão**: servidor `ws` em `127.0.0.1:47821`, token de 192 bits, `Origin` aceita só
  `chrome-extension://flkhnafholknnhekibjideljokgjencm` (ID fixo pela `key` do manifest) ou
  ausente (cliente VS Code), mais `timingSafeEqual` no token.
- **Por quê**: o mesmo servidor atende Chrome e VS Code. Native Messaging exigiria um processo
  host registrado no Chrome e outro canal até o Electron.
- **Alternativa**: Native Messaging. Rejeitada por ter mais partes móveis na POC.

### D2: Envio ao Claude Code pela extensão do VS Code
- **Decisão**: digitar no terminal integrado, pela API documentada `Terminal.sendText`.
- **Alternativas avaliadas**:
  - `claude -p --resume <id>`: cria outro processo da mesma sessão em paralelo. Proibido pelo briefing.
  - Socket interno `/tmp/cc-socks/<pid>.sock`: é o canal que o Claude Code usa entre sessões
    (exige chave por sessão). A mensagem chega marcada como vinda de **outra sessão**, não do
    usuário. Rejeitado.
  - AppleScript / System Events: o terminal do VS Code não tem API de AppleScript; digitar
    pelo teclado exige permissão de acessibilidade e foco de janela. Rejeitado por ser frágil.
- **Limitação**: sessões no app Claude Desktop, no Terminal.app ou no Warp ficam **só leitura**
  (podem ser origem, não destino).

### D3: Anexos reais no ChatGPT (modo padrão) + modo "colar como texto"
- O anexo usa o caminho achatado como nome (`specs__001__spec.md`), e o texto da mensagem lista
  o caminho real de cada anexo.
- O modo texto delimita cada arquivo com `===== INÍCIO/FIM DO ARQUIVO: <caminho> =====`.

### D4: Confirmação observável
- **ChatGPT**: relê a conversa até achar uma mensagem do usuário com o texto exato, criada
  depois do envio.
- **Claude**: relê o transcript até achar o prompt humano com o texto exato, com data depois do envio.
- Se não aparecer em 45 s, o estado fica "não confirmado". O próximo clique **verifica de novo
  antes** de reenviar.

### D5: Persistência em JSON
- `~/.integra-claude/config.json` (token, porta, última seleção, modo de arquivo) e
  `bridge.json` (porta e token para o VS Code). SQLite não foi necessário.

## Fragilidades registradas

| Dependência | Arquivo isolado | O que pode quebrar |
|---|---|---|
| Endpoints `/backend-api` do ChatGPT | `extensions/chrome/background.js` (`pageApi`), `app/.../chatgpt/extract.ts` | Mudança de formato ou de autenticação |
| HTML do campo de mensagem (ProseMirror, `button[type=submit]`) | `background.js` (`pageSend`, `pageComposerState`) | Mudança de layout. O app recusa enviar se o texto não entrar no campo |
| `~/.claude/sessions/*.json` e transcripts JSONL | `app/.../claude/sessions.ts`, `transcript.ts` | Nova versão do Claude Code |
| Bracketed paste no terminal | `extensions/vscode/extension.js` | Mudança no tratamento de colagem do Claude Code |

## Achados extras

- Conversas dentro de "Projetos" do ChatGPT podem não aparecer na listagem geral (limitação mostrada na interface).
- A primeira abertura do `claude` numa pasta nova pergunta se a pasta é confiável. Isso exige
  resposta manual uma única vez.
- Se houver rascunho digitado no campo do ChatGPT, o envio é recusado para não misturar textos.
  No terminal do Claude não há como detectar rascunho: não deixe texto digitado no prompt antes de enviar.
