# 0046 — Escrita interna global com rastro obrigatório

> **Situação atual (2026-10-14).** A escrita interna global com rastro continua sendo a regra base, mas a lista de exceções desta ADR e das notas abaixo não vale mais como lista. A [ADR 0085](./0085-modelo-de-permissoes-por-perfil.md) fixou a base (as três exceções abaixo mais cancelar fatura, baixa manual e registro da Restituição) e a lista fechada das exceções aceitas, com o motivo de cada uma; restrição fora dela é defeito.
> Da nota de 2026-09-23: a abertura da exclusão de escala de exportação (migration `080`) foi desfeita pela migration `088` ([ADR 0071](./0071-ce-mercante-como-trava-de-exclusao.md)); a importação do Baplie aberta a todos e a Dispute com Equipamentos e Administrativo continuam. A implementação original é a migration arquivada `295`.
> Regra vigente em [Segurança](../operations/seguranca.md), seção "Modelo de permissões por perfil".

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Comunicação e edição de caixas têm permissão customer_communications; a chave global de envio possui guarda administrativa própria. São exceções posteriores à escrita global.
> Rastreabilidade: [ADR 0059](./0059-chave-global-de-envio-desligada-por-padrao.md), [ADR 0060](./0060-primeira-permissao-do-perfil-equipamentos.md), [ADR 0064](./0064-caixas-de-comunicacao-e-auditoria-de-contatos.md); [migration ativa 008](../../supabase/migrations/008_portal_contact_boxes.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

> **Nota editorial — 2026-09-23.** Decisões do alinhamento entre apresentação,
> documentação e código ([plano](../archive/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md)):
> a importação do Baplie deixou de exigir Administrativo (migration 077); a
> remoção de escala de exportação sem vínculo passou a qualquer Departamento
> ativo, com a trava de vínculo e a auditoria no banco — exceção à regra de
> exclusão operacional abaixo (migration 080); e a resposta e reabertura de
> disputa de Demurrage ficam com Equipamentos e Administrativo (migration 081).

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
