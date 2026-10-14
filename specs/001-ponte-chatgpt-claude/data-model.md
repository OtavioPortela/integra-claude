# Data Model

Tipos em `app/src/shared/types.ts`.

| Entidade | Identidade estável | Campos principais | Origem |
|---|---|---|---|
| ChatConversation | `id` (UUID da conversa) | title, updatedAt | `/backend-api/conversations` |
| ClaudeSession | `sessionId` (UUID) | title, cwd, project, state (`idle`/`busy`/`history`), canReceive, receiveBlockedReason | `~/.claude/sessions`, transcripts |
| LastResponse | `messageId` | text (Markdown), generating, createdAt | conversa / transcript |
| ProjectFile | `relPath` (relativo à raiz real) | size, mtimeMs, blocked (motivo) | disco |
| TransferRequest | direção + conversa + sessão + `previewMessageId` | includeResponse, files[], fileMode | interface |
| TransferState | direção | status: `idle → reading → sending → confirming → sent / unconfirmed / error` | orquestrador |
| Config (persistida) | — | token, porta, última seleção, fileMode | `~/.integra-claude/config.json` |

## Regras de transição

- `reading`: a origem precisa ter resposta, não estar gerando e ter o mesmo `messageId` da prévia.
- `sending`: o destino precisa existir, ter o mesmo ID e estar ocioso.
- `confirming → sent`: só com a mensagem encontrada no destino.
- `confirming → unconfirmed`: depois de 45 s sem confirmação. O próximo clique verifica de novo antes de reenviar.
- Mesmo conteúdo já confirmado no mesmo destino: o 1º clique avisa, o 2º reenvia.
