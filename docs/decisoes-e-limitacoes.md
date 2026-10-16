# Decisões técnicas e limitações

Detalhes dos experimentos: [research.md](../specs/001-ponte-chatgpt-claude/research.md).

## Decisões

| Decisão | Por quê |
|---|---|
| Electron + React + TS | Stack proposta. Um app só, com a lógica toda em TS testável |
| WebSocket local, e não Native Messaging | Um servidor atende Chrome e VS Code. Native Messaging exigiria um host extra |
| Segurança local | Só 127.0.0.1, token de 192 bits, Origin fixa da extensão, arquivos com permissão 600 |
| Extensão do VS Code para enviar ao Claude | Única forma documentada de escrever numa sessão **já aberta**, sem criar outro processo |
| AppleScript para Terminal.app e iTerm2 | Ambos expõem o `tty` de cada aba/sessão: a aba é achada pelo TTY do processo `claude` (`ps`), sem abrir aba nem processo. O texto vai como colagem (`ESC[200~…ESC[201~`) e é passado por argv ao `osascript`, nunca interpolado no script |
| JSON em vez de SQLite | Só há configuração e seleção para guardar |
| Anexo real no ChatGPT | Validado: o ChatGPT lê o arquivo. "Colar como texto" fica como alternativa |
| Extensões como "braços finos" | A lógica fica no app; quando o ChatGPT ou o Claude Code mudarem, conserta-se num arquivo isolado |

## Limitações conhecidas

1. **Recebem mensagens:** sessões no terminal do VS Code, no Terminal.app e no iTerm2.
   Sessões no app Claude Desktop, no Warp ou dentro de tmux/screen aparecem como "só leitura"
   (servem de origem, não de destino).
   - **Terminal.app** (validado): `do script` na aba com o mesmo TTY. Na 1ª vez o macOS pede
     permissão de Automação (Ajustes › Privacidade e Segurança › Automação). Antes de escrever, o app
     confere que o `claude` está em **primeiro plano** no TTY (`ps` com `+`), que o sessionId não mudou
     e que a sessão está ociosa; a entrega é confirmada pelo transcript.
   - **iTerm2** (implementado, **não validado**: o iTerm2 não estava instalado na máquina de teste):
     `write text … newline NO` na sessão com o mesmo `tty`, pausa de 0,4 s e Enter.
   - **Warp: inviável.** Não tem dicionário AppleScript (`sdef` falha) nem API/CLI para escrever numa
     aba existente; o esquema `warp://` só abre abas/janelas novas. Restaria simular teclado
     (System Events), que depende do foco e pode digitar na janela errada — contra a constituição.
   - **Painel da extensão Claude Code no VS Code** (`entrypoint: claude-vscode`): só leitura. O link
     oficial `vscode://anthropic.claude-code/open?session=…&prompt=…` recusa sessões já abertas
     ("Session is already open. Your prompt was not applied") e não há comando para escrever na caixa
     do painel. Simular teclado foi avaliado e descartado pelo usuário (risco de janela errada).
   - **tmux/screen:** o ancestral é o servidor do tmux, não o app de terminal; fica só leitura.
2. **Depende de formatos internos (frágil):**
   - ChatGPT: endpoints `/backend-api` e HTML do campo de mensagem → `extensions/chrome/background.js`
   - Claude Code: `~/.claude/sessions/*.json` e transcripts JSONL → `app/src/main/integrations/claude/`
3. **Rascunho no terminal do Claude:** o app não consegue ver texto já digitado no prompt do
   Claude. Se houver, o envio se junta a ele. Deixe o prompt vazio antes de enviar.
   (No ChatGPT há proteção: com rascunho ou anexo pendente, o envio é recusado.)
4. **Conversas dentro de "Projetos" do ChatGPT** podem não aparecer na lista.
5. **Nome de anexo repetido:** o ChatGPT acrescenta "(n)". A mensagem lista o caminho real.
6. **O aviso de reenvio** vale só enquanto o app está aberto.
7. **Primeira abertura do Claude numa pasta nova:** a pergunta "confia nesta pasta?" precisa de resposta manual.
8. **Uma instância do app por vez** (porta fixa 47821).

## Verificação dos riscos principais

| Risco | Proteção | Como foi verificado |
|---|---|---|
| Destino incorreto | IDs estáveis; antes de enviar, revalida PID → sessionId (Claude) e URL `/c/<id>` (ChatGPT); confirmação procura o texto **no destino escolhido** | Testes reais: a mensagem apareceu só na sessão e na conversa de teste |
| Duplicidade | Trava por direção; aviso no reenvio; "não confirmado" verifica antes de reenviar | Clique duplo real = 1 envio; testes unitários |
| Resposta incompleta | Só envia com fim de turno (`end_turn` / `turn_duration`) e estado ocioso; recusa se a resposta mudou depois da prévia | Testes reais com ChatGPT e Claude gerando |
| Leitura de arquivos | realpath dentro da raiz, sem links, bloqueio de sensíveis/binários/>512 KB, leitura no momento do envio | Testes automatizados (`project-files.test.ts`) |

## Bug encontrado e corrigido durante os testes

- O Claude Code grava colagens longas como `<pasted_content id="…">`, o que fazia a confirmação
  falhar. Durante a investigação, 3 cópias foram enviadas à **sessão de teste**. Corrigido e coberto por teste.
- Anexo com nome repetido travava a espera do upload. Agora a espera conta os anexos e limpa o
  que a extensão colocou se algo falhar.
