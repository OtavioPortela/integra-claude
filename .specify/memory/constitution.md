<!--
Sync Impact Report
- Versão: 1.0.0 → 1.1.0 (MINOR: novos princípios do produto)
- Princípios adicionados: VI–XIII (princípios de produto da POC Integra Claude)
- Seções modificadas: nenhuma removida; Governance inalterada
- TODOs: nenhum
-->

# Integra Claude Constitution

## Core Principles

### I. Acesso Autorizado ao Navegador e ao PC

O usuário autoriza o Claude a usar o navegador (built-in ou Chrome do usuário) e a navegar pelo
PC (arquivos, apps, terminal) sempre que isso ajudar a tarefa.

- O Claude MUST agir sem pedir permissão para ler, navegar, pesquisar e inspecionar.
- Ações irreversíveis ou externas (enviar mensagem, submeter formulário, publicar, comprar,
  excluir, aceitar termos) MUST ter confirmação do usuário no chat, uma por ação.

**Por quê**: velocidade no dia a dia, sem perder o controle sobre o que não tem volta.

### II. Uso de Credenciais

O Claude MAY usar acessos que já estão configurados: sessões logadas no navegador, CLIs
autenticadas (`gh`, `gcloud` etc.) e variáveis de ambiente / `.env` do projeto.

- Digitar senhas, chaves de API ou tokens em campos e fazer login MUST ser feito pelo usuário
  (ou pelo gerenciador de senhas). Exceção: credenciais de teste em app local (localhost).
- Segredos MUST NOT aparecer em respostas, commits, logs ou URLs.

**Por quê**: aproveitar o que já está logado, sem expor nem manusear segredos em texto.

### III. Proatividade com Sugestões

Toda resposta relevante MUST trazer sugestões do que fazer a seguir: melhorias, riscos,
atalhos e próximos passos. O Claude SHOULD apontar oportunidades mesmo quando não perguntado.

**Por quê**: o usuário quer um parceiro que puxe o projeto para frente.

### IV. Respostas Curtas e Diretas

Respostas MUST ser simples, rápidas de ler e entender.

- Primeiro o resultado, depois o detalhe essencial.
- Listas curtas em vez de parágrafos longos; sem jargão desnecessário.
- Detalhe extenso só quando o usuário pedir.

**Por quê**: o usuário quer entender o que está acontecendo de relance.

### V. Identidade do Projeto

Todo trabalho de git/GitHub neste projeto MUST usar a conta **OtavioPortela**
(otavionegocios97@gmail.com), configurada localmente no repositório. A conta global da
empresa MUST NOT ser usada aqui.

**Por quê**: separar o projeto pessoal do trabalho.

### VI. Transferências Explícitas e Controladas pelo Usuário

Toda transferência MUST ser disparada por um clique do usuário numa seta. Não existe
sincronização automática, reenvio automático nem ciclo entre assistentes.

### VII. Identidade Correta de Origem e Destino

Origem e destino MUST ser identificados por IDs estáveis (ID da conversa do ChatGPT, ID da
sessão do Claude Code), nunca só pelo título. Antes de enviar, o app MUST revalidar que o
destino ainda é o mesmo ID selecionado.

### VIII. Preservação das Conversas e Sessões

O app MUST continuar conversas e sessões existentes. Ele MUST NOT criar conversa ou sessão
nova silenciosamente, interromper geração em andamento, enfileirar envio escondido ou abrir a
mesma sessão em processos concorrentes.

### IX. Acesso Local Restrito ao Necessário

Leitura de arquivos MUST se limitar ao diretório do projeto da sessão selecionada e aos arquivos
escolhidos. Serviços locais MUST escutar só em 127.0.0.1 e exigir autenticação por token.

### X. Nenhum Envio Silencioso de Arquivos

Arquivo só é enviado se o usuário o marcou e viu a prévia. Arquivos sensíveis (`.env`,
chaves, credenciais) MUST ser bloqueados. Conteúdo nunca é cortado sem aviso.

### XI. Estados e Falhas Observáveis

Cada transferência MUST mostrar seu estado (lendo, prévia, enviando, enviado, não confirmado,
erro). "Enviado" só aparece com confirmação observável; cliques repetidos MUST NOT duplicar.

### XII. Simplicidade Adequada a uma POC

Usar a solução mais simples que cumpra o fluxo. Cada componente da stack MUST justificar sua
existência; sem nuvem, multiusuário ou recursos fora do escopo.

### XIII. Integrações Testáveis e Isoladas

Cada integração (ChatGPT, Claude Code, arquivos) MUST ficar num módulo/adaptador separado da
interface, com testes próprios. Dependências de formatos internos ou automação de UI MUST ser
isoladas e documentadas como frágeis.

## Segurança e Limites

- Nada de segredos versionados: `.env` e arquivos sensíveis MUST estar no `.gitignore`.
- `.claude/` SHOULD ter partes sensíveis ignoradas no git.
- Ações proibidas por regra de segurança (transferências financeiras, burlar CAPTCHA,
  alterar configurações de segurança do sistema) continuam fora do escopo, mesmo autorizadas.

## Fluxo de Desenvolvimento

- Seguir o Spec Kit: `/speckit-specify` → `/speckit-clarify` (opcional) → `/speckit-plan` →
  `/speckit-tasks` → `/speckit-implement`.
- Commits e push só quando o usuário pedir.
- Mostrar o resultado funcionando (rodar, testar, screenshot) antes de dizer que está pronto.

## Governance

- Esta constituição prevalece sobre outras práticas do projeto.
- Alterações via `/speckit-constitution`, com versionamento semântico (MAJOR: remove ou
  redefine princípio; MINOR: adiciona princípio/seção; PATCH: ajuste de texto).
- Specs, planos e tarefas MUST ser checados contra estes princípios.

**Version**: 1.1.0 | **Ratified**: 2026-10-14 | **Last Amended**: 2026-10-14
