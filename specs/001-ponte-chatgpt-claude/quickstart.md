# Quickstart: roteiro de teste

Instalação: veja o [README](../../README.md).

## Preparação

1. No ChatGPT, crie uma conversa de teste (ex.: "Teste integra claude") e mande qualquer pergunta.
2. No VS Code, abra um terminal em `test-fixtures/projeto-teste` e rode `claude` (responda "Yes" à pergunta de confiança).
3. Abra o app: `cd app && npx electron .`

## Roteiro (5 min)

| # | Faça | Esperado |
|---|---|---|
| 1 | Abra o app | Pílulas verdes: ChatGPT conectado, VS Code 1 janela |
| 2 | Selecione a conversa de teste e a sessão `projeto-teste` | As prévias das duas respostas aparecem |
| 3 | **ChatGPT → Claude** | "Enviado ✓"; o texto aparece no terminal do Claude como sua mensagem |
| 4 | Clique de novo na mesma seta | Aviso "já foi enviado… clique de novo para reenviar" |
| 5 | Enquanto o Claude responde, clique em **ChatGPT → Claude** | Seta bloqueada: "Destino ocupado" |
| 6 | Quando o Claude terminar: marque `specs/spec.md` → **Claude → ChatGPT** | "Enviado ✓"; no ChatGPT, a mensagem com o anexo |
| 7 | Edite `specs/spec.md`, envie de novo só o arquivo (desmarque a resposta) | O ChatGPT recebe a versão nova |
| 8 | Veja o `.env` na lista | Aparece com 🔒 e não pode ser marcado |
| 9 | Peça algo longo no ChatGPT e clique em **ChatGPT → Claude** durante a geração | "Origem ainda gerando" |
| 10 | Feche e reabra o app | Seleção restaurada, sem pedir pareamento |

## O que foi testado de verdade (2026-10-14)

| Item | Situação |
|---|---|
| Listar conversas, ler a última resposta, enviar texto e anexo no ChatGPT | ✅ real (conversa de teste) |
| Descobrir sessões, ler a resposta, enviar e confirmar no Claude Code (VS Code) | ✅ real (sessão de teste) |
| Dois sentidos pela interface (Playwright clicando no app) | ✅ real |
| Bloqueios: origem gerando, destino ocupado (ChatGPT e Claude), clique duplo | ✅ real |
| Reabrir o app com a seleção restaurada | ✅ real |
| Bloqueio de `.env`, links e fora da pasta; leitura da versão em disco | ✅ testes automatizados |
| Resposta muito longa (acima do limite do ChatGPT) | ⚠️ validação manual |

## Validação de desenvolvedor

```bash
cd app && npm test                          # 30 testes (unidade + contrato)
npx tsx scripts/harness.ts sessions         # descoberta real de sessões
npx tsx scripts/harness.ts chatList         # descoberta real de conversas
node scripts/ui-e2e.mjs /tmp/shots          # abre o app e tira screenshot
```

Feche o app antes do harness ou do E2E: todos usam a mesma porta, 47821.
