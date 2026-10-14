# Tasks: Ponte ChatGPT ↔ Claude Code

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md)

Formato: `[ID] [P?] [Story] Descrição`. [P] = pode rodar em paralelo. Marcado `[x]` = feito
nesta POC.

## Phase 1: Setup

- [x] T001 Criar `app/` (Electron + electron-vite + React + TS) com `package.json`, `tsconfig.json`, `electron.vite.config.ts`
- [x] T002 [P] Criar `extensions/chrome/` (MV3, ID fixo via `key`)
- [x] T003 [P] Criar `extensions/vscode/` e empacotar `.vsix`
- [x] T004 [P] Criar `test-fixtures/projeto-teste/` (README, specs/spec.md, .env falso)

## Phase 2: Foundational (bloqueia as histórias)

- [x] T005 Tipos compartilhados em `app/src/shared/types.ts`
- [x] T006 Config persistente em `app/src/main/config/store.ts` (`~/.integra-claude`, 600)
- [x] T007 Servidor WS local com token e Origin em `app/src/main/bridge/server.ts`
- [x] T008 [P] Teste de contrato do servidor em `app/tests/bridge-server.test.ts`
- [x] T009 Conexão e reconexão da extensão Chrome (`background.js`, popup de pareamento)
- [x] T010 Conexão e reconexão da extensão VS Code (`extension.js`, lê `bridge.json`)

## Phase 3: US4 Descobrir conversas e sessões (P1)

- [x] T011 [P] [US4] Listar conversas com paginação (`listConversations`, `ChatGptAdapter.listConversations`)
- [x] T012 [P] [US4] Descobrir sessões ativas e históricas em `integrations/claude/sessions.ts`
- [x] T013 [US4] Mapear sessão → terminal do VS Code (PID do shell é ancestral do `claude`) em `claude/adapter.ts`
- [x] T014 [US4] Listas na interface com título, projeto, diretório, data, estado e alcance ("há mais / carregar mais")

## Phase 4: US1 ChatGPT → Claude (P1)

- [x] T015 [P] [US1] Extrair a última resposta do ChatGPT em `chatgpt/extract.ts` + testes
- [x] T016 [US1] `sendText` no VS Code com bracketed paste + Enter
- [x] T017 [US1] Confirmar pelo transcript (inclui o invólucro `<pasted_content>`) + testes
- [x] T018 [US1] Bloqueios: origem gerando, destino ocupado, sessão mudou de ID, só leitura

## Phase 5: US2 Claude → ChatGPT (P1)

- [x] T019 [P] [US2] Extrair a última resposta do Claude em `claude/transcript.ts` + testes
- [x] T020 [US2] `sendMessage` na extensão (aba existente ou aba de trabalho, colar, enviar)
- [x] T021 [US2] Recusar rascunho ou anexos pendentes; limpar o que a extensão colocou se falhar
- [x] T022 [US2] Confirmar pela API da conversa

## Phase 6: US3 Arquivos do projeto (P2)

- [x] T023 [P] [US3] Listar e ler arquivos com bloqueios em `files/project-files.ts` + testes
- [x] T024 [US3] Anexo real (padrão) e modo "colar como texto" delimitado
- [x] T025 [US3] Painel de arquivos com filtro, prévia e "Reler do disco"

## Phase 7: US5 Reabrir mantendo configuração (P3)

- [x] T026 [US5] Persistir a seleção e o modo de arquivo; reconectar sozinho

## Phase 8: Orquestração e robustez

- [x] T027 Orquestrador com trava por direção, prévia ↔ envio (`messageId`), "não confirmado" com verificação antes de reenviar
- [x] T028 Aviso de reenvio do mesmo conteúdo para o mesmo destino (2º clique confirma)
- [x] T029 Testes do orquestrador em `app/tests/orchestrator.test.ts`

## Phase 9: Validação real

- [x] T030 Harness de integração real `app/scripts/harness.ts`
- [x] T031 E2E pela interface `app/scripts/ui-e2e.mjs` e `ui-restore.mjs`
- [x] T032 Documentação: `README.md`, `quickstart.md`, `docs/decisoes-e-limitacoes.md`

## Pendências (fora desta POC)

- [ ] T033 Adaptador para outros terminais (Terminal.app/iTerm via AppleScript, Warp)
- [ ] T034 Listar conversas dentro de "Projetos" do ChatGPT
- [ ] T035 Persistir o histórico de envios entre reaberturas (hoje o aviso de reenvio vale só durante a execução)
- [ ] T036 Empacotar o app como `.app` assinado
