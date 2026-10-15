---
name: integra-claude
description: Usar quando o usuário pedir para mandar algo para o ChatGPT/GPT ou trazer algo de lá — ex. "envia isso pro GPT", "manda esse plano pro ChatGPT", "manda a spec pro GPT revisar", "o que o GPT respondeu?", "pega a última resposta do ChatGPT", "lê a conversa X do GPT" — ou para mandar uma mensagem para OUTRA sessão do Claude Code ("manda isso pra sessão do projeto Y"). Usa o app local Integra Claude (projeto em ~/Desktop/integra-claude) pelo comando de terminal `integra`, que lista as conversas reais do ChatGPT do usuário (pelo Chrome dele), lê a última resposta e envia mensagens/arquivos nas conversas EXISTENTES, com confirmação de entrega.
---

# Integra Claude: ponte com o ChatGPT

O usuário tem no Mac o app **Integra Claude** (`~/Desktop/integra-claude`), que liga as conversas
dele no ChatGPT (Chrome) às sessões do Claude Code. O comando `integra` fala com o app por baixo
e **abre o app sozinho** se ele estiver fechado. Não é preciso clicar em nada.

## Comandos

```bash
integra status                       # ChatGPT (Chrome) e VS Code conectados?
integra conversas                    # lista conversas do ChatGPT (título, data, id)
integra conversas --mais 28          # próxima página
integra ler <idConversa>             # última resposta do ChatGPT nessa conversa
integra enviar-gpt <idConversa> [--arquivo caminho/relativo ...] [--modo anexar|texto] <<'EOF'
texto
EOF
integra sessoes                      # sessões ativas do Claude Code
integra ler-claude <idSessao>        # última resposta de outra sessão do Claude
integra enviar-claude <idSessao> <<'EOF'
texto
EOF
```

- `--arquivo` lê o arquivo **da pasta atual** (o projeto desta sessão), na versão salva em disco,
  e envia como **anexo real** no ChatGPT (`--modo texto` cola o conteúdo delimitado). `.env`,
  chaves e credenciais são bloqueados pelo app.
- Saída `✅ Enviado ✓ (confirmado no destino)` = chegou de verdade. `⚠️`/`❌` = não chegou ou
  não foi confirmado: mostre a mensagem ao usuário.
- `--json` em qualquer comando dá a saída estruturada.

## Fluxo: "envia isso pro GPT"

1. **Descubra o que é "isso"**: em geral, a sua última resposta, um plano/trecho que você acabou de
   escrever ou arquivos do projeto (spec, plano, constituição). Se estiver ambíguo, pergunte em uma linha.
2. **Liste as conversas**: rode `integra conversas` e mostre ao usuário **só os títulos numerados**
   (os 10 primeiros, mais "tem mais"). Se o usuário já disse o nome da conversa, encontre pelo título
   e confirme ("Vou mandar para **Integrar chat de voz**, ok?").
3. **Pergunte qual conversa** (use a ferramenta de pergunta se houver, com os títulos como opções).
   Nunca escolha sozinho quando houver dúvida.
4. **Envie** com heredoc (aspas simples em `'EOF'` para não expandir `$`):
   ```bash
   integra enviar-gpt <id> <<'EOF'
   <conteúdo completo, sem resumir>
   EOF
   ```
   Para arquivos: `integra enviar-gpt <id> --arquivo specs/001-x/spec.md <<'EOF' ... EOF`
   (o texto pode ser só uma linha explicando o anexo).
5. **Relate em uma linha**: "✅ Enviado para *Título*" ou o erro.

## Fluxo: "o que o GPT respondeu?" / "pega a resposta do GPT"

1. Ache a conversa (`integra conversas`; pergunte qual se não estiver claro).
2. `integra ler <id>`: use o texto como entrada (ex.: aplicar as sugestões, seguir o prompt).
   Não precisa colar nada no terminal: você mesmo lê.
3. Se aparecer "ainda está gerando", espere uns segundos e leia de novo.

## Fluxo: mandar para outra sessão do Claude

`integra sessoes` → pergunte qual (mostre título e projeto) → `integra enviar-claude <id>`.
Sessões marcadas como "só leitura" (app Claude Desktop, Warp) não recebem mensagens.
Não tente enviar para **a sua própria sessão**: ela está ocupada enquanto você roda o comando.

## Regras

- Só envie quando o usuário pedir. Nada de envios automáticos ou em loop entre os assistentes.
- Envie o conteúdo **completo**; não resuma sem o usuário pedir.
- Se o app avisar "já foi enviado", pergunte antes de repetir com `--forcar`.
- Erros comuns:
  - "Navegador desconectado": peça para abrir o Chrome; se a extensão Integra Claude mostrar
    "não pareado", o usuário pareia pelo botão "Copiar código de pareamento" no app.
  - "Destino ocupado": o ChatGPT ou o Claude está respondendo; espere e tente de novo.
- Detalhes do projeto e das limitações: `~/Desktop/integra-claude/README.md` e
  `~/Desktop/integra-claude/docs/decisoes-e-limitacoes.md`.
