# Notas históricas retiradas do índice de planos

Snapshot preservado em 2026-09-18. As entregas abaixo já têm planos/specs
arquivados; seus estados intermediários não descrevem o trabalho ativo.

### Sincronização de 2026-09-01

> **Nota de sincronização do Bloco 1 (PR #645).**
> O **Bloco 1 — Fundação** do plano de Comunicação por E-mail com Clientes foi implementado
> na [PR #645](https://github.com/luccafwlog/transhippingdesk/pull/645) (migration `372_comunicados_fundacao.sql`),
> cobrindo a mecânica compartilhada `_shared/email.ts`, modelo de dados com idempotência `NULLS NOT DISTINCT`,
> isolamento de naturezas, RLS e permissão RBAC `customer_communications`, webhook com cascata de bounce
> e preferências de recebimento na Ficha do Cliente.

> **Nota de execução do Bloco 2 (branch `codex/comunicacao-email-clientes-bloco-2`).**
> T8–T15 foram implementadas localmente com as migrations `373_comunicados_anexos.sql`
> e `374_comunicados_alertas.sql`, a rota de conferência/histórico, renderizadores
> NOA/NOR/NOB, dispatch simulado e os detectores de alertas. O plano permanece
> **IN PROGRESS** até os gates e a validação remota; os Blocos 3–4 continuam TODO.

### Sincronização de 2026-08-20

O plano de 2026-08-11 foi ressincronizado com as decisões posteriores a ele —
ADR 0053 (ciclo de vida e dispensa temporária), ADR 0054 (Portal como gate) e as
cinco specs de bloco. Passou a ter um item **E4 — dispensa temporária** no Bloco
0, o catálogo completo de gravidade por evento no E1 e o mapa entre as letras do
catálogo (A–D) e as issues #520–#525.

> **Nota de sincronização de migrations (PRs #568, #569, #570, #571, #573, #574, #576).**
> A fundação transversal E1–E4 foi totalmente implementada e mergeada em `main`
> pela PR #568 (migrations `317`–`321`). Na sequência:
> - PR #569 entregou o onboarding em lote de grupos de clientes (migration `322`).
> - PR #570 integrou os alertas de ADR / Relatório de Agência (migration `323`).
> - PR #571 implementou o Bloco 2 (#521 — Clientes, Portal e Disputes); a numeração final da integração é `325`.
> - PR #573 implementou o Bloco 3 (#522 — Financeiro e Reconciliação PIX).
> - PR #574 implementou o Bloco 1 (#520 — B/L e Revisão Manual) via migration `324_review_bl_alerts_lifecycle.sql`.
> - A PR #576 integrou o **Bloco 4 (#523 — Operação e Viagem)** e os demais produtores dos Blocos 1–5.
> - O **Bloco 6 (#525 — Transversal e Portal do Cliente)** entregou o sino interno, a fila `/alertas` completa, o resumo do `/painel`, a observabilidade de falhas e o Eco de Tratamento (migration `339`).

### Nota editorial sobre o registro de decisões de #519

A regra de encerramento de #519 nomeia
`docs/plans/2026-08-11-alertas-e-notificacoes.md` como destino das decisões.
Para o Bloco #521, esse registro foi formalizado como spec funcional em
[`../archive/specs/2026-08-15-clientes-portal-alertas-design.md`](../archive/specs/2026-08-15-clientes-portal-alertas-design.md), que é a fonte histórica ligada ao
plano acima. A substituição é intencional: a spec separa decisões funcionais
do plano de execução e deve ser consultada pelos blocos seguintes até que um
registro transversal seja consolidado.
