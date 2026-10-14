# Feature Specification: Ponte ChatGPT ↔ Claude Code

**Feature Branch**: `001-ponte-chatgpt-claude`

**Created**: 2026-10-14

**Status**: Draft

**Input**: Briefing do usuário: POC de app macOS que transfere, sob comando manual, a última
resposta completa entre uma conversa existente do ChatGPT e uma sessão existente do Claude Code,
nos dois sentidos, incluindo arquivos textuais do projeto.

## Clarifications

### Session 2026-10-14

- Q: Sessões fora do terminal do VS Code (app Claude Desktop, Terminal.app, Warp) podem ser destino? → A: Não nesta POC. Aparecem como "só leitura" (podem ser origem). O usuário usa o Claude Code no terminal do VS Code.
- Q: Arquivos vão como anexo real ou como texto? → A: Anexo real por padrão (validado), com opção "colar como texto" delimitado.
- Q: O que fazer com o mesmo conteúdo enviado duas vezes ao mesmo destino? → A: O 1º clique avisa; o 2º clique reenvia.
- Q: Arquivos também vão no sentido ChatGPT → Claude? → A: Não. O Claude já tem acesso ao projeto; arquivos valem para Claude → ChatGPT.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enviar resposta do ChatGPT para o Claude Code (Priority: P1)

O usuário discutiu uma ideia por voz no ChatGPT e quer mandar a última resposta para a sessão
do Claude Code onde está desenvolvendo. Ele abre o app, escolhe a conversa à esquerda, a sessão
à direita, confere a prévia e clica em "ChatGPT → Claude". O texto chega na sessão como uma
mensagem dele.

**Why this priority**: é o fluxo mais frequente e elimina a cópia manual principal.

**Independent Test**: com uma conversa de teste no ChatGPT e uma sessão de teste do Claude Code,
clicar na seta e ver a mensagem aparecer na sessão certa, como mensagem do usuário.

**Acceptance Scenarios**:

1. **Given** uma conversa com resposta concluída e uma sessão ociosa, **When** o usuário clica
   em "ChatGPT → Claude", **Then** a sessão recebe exatamente o texto da prévia como nova
   mensagem do usuário e o app mostra "Enviado" após confirmar o recebimento.
2. **Given** o ChatGPT ainda está gerando, **When** o usuário clica na seta, **Then** o envio é
   bloqueado com a mensagem "Origem ainda gerando".
3. **Given** a sessão do Claude está ocupada, **When** o usuário clica na seta, **Then** nada é
   enviado e o app informa "Destino ocupado".

---

### User Story 2 - Enviar resposta do Claude Code para o ChatGPT (Priority: P1)

Após o Claude terminar um turno, o usuário quer levar a resposta final para a conversa do
ChatGPT e retomar a conversa por voz. Ele clica em "Claude → ChatGPT"; a resposta chega como
nova mensagem dele na conversa existente selecionada.

**Why this priority**: completa o ciclo; os dois sentidos são obrigatórios para a POC.

**Independent Test**: com uma sessão de teste com turno concluído e uma conversa de teste,
clicar na seta e ver a mensagem na conversa certa do ChatGPT.

**Acceptance Scenarios**:

1. **Given** sessão com turno concluído e conversa existente selecionada, **When** o usuário
   clica em "Claude → ChatGPT", **Then** a conversa recebe a resposta final (sem raciocínio
   interno nem logs de ferramentas) como nova mensagem do usuário.
2. **Given** o ChatGPT está gerando resposta na conversa destino, **When** o usuário clica,
   **Then** o envio é recusado com "Destino ocupado".
3. **Given** a conexão com o navegador caiu, **When** o usuário clica, **Then** o app mostra
   "Navegador desconectado" e não marca nada como enviado.

---

### User Story 3 - Enviar arquivos do projeto (Priority: P2)

O usuário quer que o ChatGPT leia a constituição, a especificação ou o plano do projeto. Ao
escolher a sessão, o app lista os arquivos textuais do diretório do projeto. O usuário marca os
arquivos, vê a prévia e envia só os arquivos ou os arquivos junto com a última resposta.

**Why this priority**: muito útil, mas depende dos fluxos P1.

**Independent Test**: marcar um Markdown de um projeto de teste, alterar o arquivo no disco,
enviar e conferir que o ChatGPT recebeu o conteúdo atualizado, identificado pelo caminho.

**Acceptance Scenarios**:

1. **Given** uma sessão selecionada, **When** o painel de arquivos abre, **Then** aparecem nome
   e caminho relativo dos arquivos textuais do diretório do projeto.
2. **Given** um arquivo marcado e editado depois da prévia, **When** o usuário envia, **Then**
   o conteúdo enviado é a versão salva em disco no momento do envio, e a prévia é atualizada.
3. **Given** um arquivo `.env` ou de credencial, **When** a lista é montada, **Then** ele aparece
   bloqueado e não pode ser marcado.
4. **Given** vários arquivos marcados, **When** o envio é feito, **Then** cada arquivo chega
   claramente delimitado e identificado pelo caminho relativo.

---

### User Story 4 - Descobrir conversas e sessões (Priority: P1)

O usuário vê à esquerda as conversas do ChatGPT e à direita as sessões do Claude Code, com
título em destaque e projeto, diretório, data e estado como informação extra. Ele sabe quantas
conversas foram carregadas e pode carregar mais.

**Why this priority**: sem seleção correta não há transferência segura.

**Independent Test**: abrir o app e conferir que a lista bate com o que se vê no ChatGPT e no
terminal, inclusive o indicador "mostrando N de muitas — carregar mais".

**Acceptance Scenarios**:

1. **Given** extensão conectada, **When** o app abre, **Then** a lista mostra as conversas mais
   recentes e indica explicitamente que é parcial, com botão "Carregar mais".
2. **Given** sessões ativas e históricas, **When** a lista abre, **Then** sessões ativas aparecem
   separadas das históricas, e só sessões em que o envio é possível ficam habilitadas como destino.

---

### User Story 5 - Reabrir mantendo a configuração (Priority: P3)

Ao reabrir o app, o pareamento com a extensão e a última seleção continuam válidos.

**Independent Test**: fechar e reabrir o app; a extensão reconecta sem nova configuração.

**Acceptance Scenarios**:

1. **Given** app pareado, **When** é reaberto, **Then** a extensão reconecta sozinha e a última
   conversa/sessão selecionadas são restauradas se ainda existirem.

### Edge Cases

- Conversa ou sessão selecionada foi apagada/fechada entre a seleção e o envio → erro "Destino
  não encontrado", nada enviado.
- Dois cliques rápidos na mesma seta → só um envio.
- Envio feito mas sem confirmação dentro do prazo → estado "Não confirmado"; nova tentativa só
  depois de verificar se a mensagem já chegou.
- Origem sem nenhuma resposta do assistente → seta desabilitada com explicação.
- Resposta muito longa → enviada inteira; se o destino tiver limite, o app avisa antes e não corta
  em silêncio.
- Arquivo fora do diretório do projeto (link simbólico, `..`) → bloqueado.
- Arquivo binário ou muito grande → bloqueado com motivo.
- ChatGPT deslogado ou aba fechada → "ChatGPT indisponível" com instrução.
- Sessão do Claude aberta num ambiente que o app não consegue controlar → aparece como
  "somente leitura" (pode ser origem, não destino).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O app MUST mostrar numa única janela: conversas do ChatGPT (esquerda), sessões do
  Claude Code (direita), duas setas no centro, prévia, painel de arquivos e status da transferência.
- **FR-002**: O app MUST identificar conversas e sessões por IDs estáveis e exibir o título como
  informação principal.
- **FR-003**: O app MUST indicar o alcance da descoberta de conversas (quantas carregadas, se há
  mais) e permitir carregar mais.
- **FR-004**: O app MUST distinguir sessões ativas de históricas e mostrar projeto/diretório.
- **FR-005**: O app MUST obter a última resposta completa do assistente da origem: só a resposta
  final do turno, preservando texto, código e formatação Markdown; sem raciocínio interno, logs de
  ferramentas ou histórico.
- **FR-006**: O app MUST mostrar a prévia do conteúdo exato antes de enviar.
- **FR-007**: O app MUST enviar o conteúdo como nova mensagem do usuário na conversa/sessão
  existente selecionada, nunca criando outra.
- **FR-008**: O app MUST bloquear o envio se a origem estiver gerando e recusar se o destino
  estiver ocupado, sem interromper, enfileirar ou injetar nada.
- **FR-009**: O app MUST impedir envios duplicados por cliques repetidos.
- **FR-010**: O app MUST mostrar "Enviado" só com confirmação observável; caso contrário,
  "Não confirmado", e verificar o destino antes de permitir nova tentativa.
- **FR-011**: O app MUST listar arquivos textuais do diretório da sessão selecionada (nome e
  caminho relativo), permitir marcar arquivos, mostrar prévia e ler o conteúdo do disco no
  momento do envio.
- **FR-012**: O app MUST permitir enviar arquivos junto da última resposta ou só os arquivos.
- **FR-013**: O app MUST bloquear arquivos sensíveis (`.env*`, chaves, credenciais), arquivos
  fora do diretório do projeto, binários e arquivos acima do limite de tamanho.
- **FR-014**: Cada arquivo enviado MUST chegar identificado pelo caminho relativo e delimitado.
- **FR-015**: Conteúdo MUST NOT ser cortado silenciosamente; qualquer limite gera aviso antes.
- **FR-016**: O app MUST mostrar erros úteis para: navegador desconectado, ChatGPT indisponível,
  geração em andamento, sessão indisponível, falha no envio.
- **FR-017**: O app MUST persistir pareamento e última seleção entre reaberturas.
- **FR-018**: A comunicação local MUST ser restrita à máquina e autenticada.
- **FR-019**: Integrações (ChatGPT, Claude Code, arquivos) MUST ser módulos separados da interface.
- **FR-020**: O app MUST NOT transferir nada automaticamente.

### Key Entities

- **Conversa ChatGPT**: ID, título, data de atualização, estado (gerando/ociosa).
- **Sessão Claude Code**: ID da sessão, título, diretório do projeto, data, estado
  (ativa-ociosa / ativa-ocupada / histórica), capacidade de envio (controlável / somente leitura).
- **Resposta**: texto Markdown da última resposta do assistente, ID da mensagem de origem.
- **Arquivo do projeto**: caminho relativo, tamanho, data de modificação, bloqueado (motivo).
- **Transferência**: direção, origem, destino, conteúdo, arquivos, estado, horário, ID de
  idempotência.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O usuário transfere uma resposta em qualquer sentido em até 3 cliques após abrir
  o app (selecionar origem, selecionar destino, seta).
- **SC-002**: 100% das transferências chegam no destino selecionado (zero destino errado nos
  testes do roteiro).
- **SC-003**: 0 duplicações em 10 cliques rápidos seguidos na mesma seta.
- **SC-004**: O texto recebido é idêntico à prévia (comparação de conteúdo) em 100% dos testes.
- **SC-005**: Arquivos enviados refletem a versão em disco no instante do envio em 100% dos testes.
- **SC-006**: Todos os 5 tipos de falha do FR-016 exibem mensagem específica.
- **SC-007**: Após reabrir o app, a reconexão acontece sem intervenção em até 10 segundos.

## Assumptions

### Premissas

- Usuário único, um Mac (macOS 15), Chrome com ChatGPT logado.
- O usuário encerra o modo de voz antes de transferir.
- Primeiro foco em arquivos textuais (Markdown, txt, json, yaml, código).
- Fora do escopo: nuvem, multiusuário, voz em tempo real, sincronização contínua, cobrança,
  outros sistemas operacionais.

### Hipóteses técnicas a validar (não comprovadas)

- **H1**: É possível listar conversas do ChatGPT com paginação a partir da sessão logada no
  navegador (não existe API pública para isso).
- **H2**: É possível ler a última resposta concluída de uma conversa existente e saber se ainda
  está gerando.
- **H3**: É possível enviar mensagem numa conversa existente automatizando a página do ChatGPT,
  com confirmação observável.
- **H4**: É possível anexar arquivos reais no ChatGPT pela página; se não, usar texto delimitado.
- **H5**: Sessões do Claude Code podem ser descobertas e associadas ao diretório pelos registros
  locais do Claude Code (formato interno).
- **H6**: A última resposta do Claude pode ser lida do histórico local da sessão.
- **H7**: É possível enviar uma mensagem como usuário para uma sessão já aberta no terminal do
  VS Code sem criar outro processo da sessão.
- **H8**: O estado ocupado/ocioso de uma sessão ativa é observável localmente.
