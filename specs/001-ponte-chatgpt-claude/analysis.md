# Análise de consistência (spec ↔ plan ↔ tasks)

Executada em 2026-10-14, depois de gerar o `tasks.md`. É só leitura: aponta lacunas, não altera artefatos.

## Cobertura dos requisitos

| Requisito | Tarefas | Status |
|---|---|---|
| FR-001 janela única | T014, T025 | ✅ |
| FR-002 IDs estáveis | T011–T013, T027 | ✅ |
| FR-003 alcance da descoberta | T014 | ✅ |
| FR-004 ativas × históricas | T012, T014 | ✅ |
| FR-005 última resposta completa | T015, T019 | ✅ testado com dados reais |
| FR-006 prévia | T014, T027 | ✅ |
| FR-007 mesma conversa/sessão | T016, T020 | ✅ |
| FR-008 gerando/ocupado | T018, T021 | ✅ testado de verdade |
| FR-009 sem duplicar | T027, T028 | ✅ |
| FR-010 "Enviado" só confirmado | T017, T022, T027 | ✅ |
| FR-011–FR-014 arquivos | T023–T025 | ✅ |
| FR-015 sem corte silencioso | — | ⚠️ não testado com texto acima do limite do ChatGPT (limite desconhecido) |
| FR-016 erros úteis | T018, T021, T009 | ✅ |
| FR-017 persistência | T026 | ✅ |
| FR-018 local + autenticado | T007, T008 | ✅ |
| FR-019 integrações isoladas | estrutura | ✅ |
| FR-020 nada automático | T027 | ✅ |

## Achados

| ID | Severidade | Achado | Ação |
|---|---|---|---|
| A1 | Média | FR-015: não há teste com uma resposta muito longa (ex.: 100 mil caracteres) no ChatGPT | Testar manualmente; se o ChatGPT recusar, a extensão não envia (o texto não entra inteiro no campo) e mostra erro |
| A2 | Baixa | SC-003 pede 10 cliques; o teste real usou clique duplo e o teste unitário usou 3 cliques simultâneos | Mesmo mecanismo (trava por direção); risco baixo |
| A3 | Baixa | Ao repetir um nome de anexo, o ChatGPT acrescenta "(n)" (ex.: `specs__spec(4).md`); o texto ainda lista o caminho real | Documentado |
| A4 | Média | O aviso de reenvio vale só enquanto o app está aberto | T035 |
| A5 | Média | Sessões fora do VS Code são só leitura | Decisão registrada (Clarifications); T033 |

Nenhuma violação da constituição foi encontrada.
