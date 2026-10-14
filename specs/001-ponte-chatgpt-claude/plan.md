# Implementation Plan: Ponte ChatGPT ↔ Claude Code

**Branch**: `001-ponte-chatgpt-claude` | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-ponte-chatgpt-claude/spec.md`

## Summary

App desktop (Electron + React) com um servidor local autenticado que fala com dois "braços":
uma **extensão do Chrome**, que usa a sessão já logada do ChatGPT para listar, ler e enviar
mensagens, e uma **extensão do VS Code**, que digita no terminal integrado onde a sessão do
Claude Code está aberta. As sessões do Claude são descobertas e lidas pelos arquivos locais do
Claude Code. As hipóteses H1–H8 foram testadas antes da implementação (ver [research.md](./research.md)).

## Technical Context

**Language/Version**: TypeScript 7 (app), JavaScript (extensões), Node 24 / Electron 44

**Primary Dependencies**: electron, electron-vite, react 19, ws (servidor WebSocket)

**Storage**: JSON em `~/.integra-claude/` (permissão 600). SQLite não é necessário.

**Testing**: vitest (unidade e contrato), harness de integração real (`app/scripts/harness.ts`),
E2E pela interface com Playwright + Electron (`app/scripts/ui-e2e.mjs`)

**Target Platform**: macOS 15, Chrome, VS Code 1.90+

**Project Type**: desktop-app + 2 extensões

**Performance Goals**: transferência confirmada em menos de 15 s com resposta de até 50 KB

**Constraints**: nada sai da máquina além do que o ChatGPT já recebe; servidor só em 127.0.0.1

**Scale/Scope**: 1 usuário, 1 Mac, dezenas de conversas e sessões

## Constitution Check

| Princípio | Como o plano cumpre |
|---|---|
| VI Transferência explícita | Só a seta dispara; não há timer de envio |
| VII Identidade | IDs estáveis (conversa, `sessionId`); revalida PID → `sessionId` e URL `/c/<id>` antes de enviar |
| VIII Preservação | Usa as conversas e sessões existentes; nunca `--resume` em paralelo; recusa se ocupado; recusa se há rascunho no ChatGPT |
| IX Acesso restrito | WS em 127.0.0.1 + token + Origin fixa; arquivos só dentro da raiz (realpath) |
| X Sem envio silencioso | Arquivo só se marcado; `.env` e chaves bloqueados; sem corte de conteúdo |
| XI Estados observáveis | Estados lendo/enviando/confirmando/enviado/não confirmado/erro; "Enviado" só com confirmação no destino |
| XII Simplicidade | Sem SQLite e sem Native Messaging (exigiria um processo host extra); um único servidor WS |
| XIII Integrações isoladas | `integrations/chatgpt`, `integrations/claude`, `files`, cada um com testes |

**Resultado**: aprovado, sem violações.

## Project Structure

### Documentation (this feature)

```text
specs/001-ponte-chatgpt-claude/
├── spec.md
├── plan.md          # este arquivo
├── research.md      # resultados dos experimentos H1–H8
├── data-model.md
├── contracts/bridge-protocol.md
├── quickstart.md
└── tasks.md
```

### Source Code (repository root)

```text
app/                          # Electron + React + TS
├── src/main/
│   ├── bridge/server.ts      # WS local, token, Origin
│   ├── config/store.ts       # ~/.integra-claude
│   ├── integrations/
│   │   ├── chatgpt/          # extract.ts (FRÁGIL: JSON interno), adapter.ts
│   │   └── claude/           # transcript.ts + sessions.ts (FRÁGIL: arquivos internos), adapter.ts
│   ├── files/project-files.ts
│   └── transfer/orchestrator.ts
├── src/preload, src/renderer # interface
├── tests/                    # vitest
└── scripts/                  # harness real e E2E
extensions/
├── chrome/                   # MV3: background.js (FRÁGIL: DOM do ChatGPT), popup
└── vscode/                   # extension.js: listTerminals, sendText, openClaudeTerminal
test-fixtures/projeto-teste/  # projeto usado nos testes reais
```

**Structure Decision**: o app concentra toda a lógica (testável em TS). As extensões são
"braços finos", só executam ações e devolvem dados brutos. Assim, quando o ChatGPT ou o Claude
Code mudarem, a correção fica num arquivo isolado.

## Complexity Tracking

| Item | Por que é necessário | Alternativa mais simples rejeitada porque |
|---|---|---|
| Extensão do VS Code | Única forma documentada de digitar numa sessão já aberta no terminal | `claude --resume` cria outro processo da mesma sessão (proibido); AppleScript não funciona no terminal do VS Code; o socket interno de mensagens do Claude entrega como "mensagem de outra sessão", não do usuário |
