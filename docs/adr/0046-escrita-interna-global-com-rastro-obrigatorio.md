# 0046 — Escrita interna global com rastro obrigatório

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Comunicação e edição de caixas têm permissão customer_communications; a chave global de envio possui guarda administrativa própria. São exceções posteriores à escrita global.
> Rastreabilidade: [ADR 0059](./0059-chave-global-de-envio-desligada-por-padrao.md), [ADR 0060](./0060-primeira-permissao-do-perfil-equipamentos.md), [ADR 0064](./0064-caixas-de-comunicacao-e-auditoria-de-contatos.md); [migration ativa 008](../../supabase/migrations/008_portal_contact_boxes.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-08-13

## Contexto

A ADR 0044 corrigiu o eixo de leitura e manteve a escrita restrita por
departamento. A revisão das RPCs mostrou que esse modelo não descrevia a
operação real: a matriz do frontend, `PROFILE_SCOPES` e o banco discordavam, e
o departamento passou a ser uma responsabilidade fluida.

## Decisão

A escrita de dado interno é liberada a todo Departamento interno ativo. O
controle passa a ser o rastro obrigatório: toda escrita registra autor e
Departamento congelado no instante do evento. A leitura permanece global,
como decidido na 0044.

Três exceções permanecem: exclusão de registro operacional, somente
Administrativo; provisionamento do Portal, Administrativo e Documentação; e
administração de usuários (`/admin/usuarios`), somente Administrativo,
inclusive na leitura. O Sign-off Departamental do ADR de Saída permanece
departamental: ali o Departamento exprime responsabilidade, não permissão.
Ações automáticas assinam `sistema`.

## Consequências

O departamento deixa de bloquear trabalho legítimo e a autoridade fica
auditável. Em contrapartida, um erro de boa-fé passa a ser atribuído, não
impedido, e a auditoria se torna caminho crítico da escrita. Reintroduzir
barreiras exigiria remontar a matriz de permissões e as policies.
