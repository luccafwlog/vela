# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, encerrado ou superado por decisão
registrada, ele é movido para [`../archive/plans/`](../archive/plans/README.md)
com nota de estado e motivo; o arquivo continua sendo histórico, não fonte de
verdade sobre o estado atual.

## Planos ativos

- [2026-09-24 — Configuração de serviços e migração para Cloudflare](2026-09-24-configuracao-servicos-e-migracao-cloudflare.md) — roteiro em 10 etapas, na ordem segura: Upstash, Turnstile, Better Stack, Sentry, PostHog, backup R2, previews e produção no Pages, DNS e desligamento da Vercel.
- [2026-09-06 — Remediação das auditorias #654–#660](2026-09-06-plano-remediacao-auditorias-654-660.md) — execução parcial; famílias de rastreabilidade S14 mapeadas localmente; fixture COSCO/Granito, runtimes S05–S09, refresh/benchmark S12, validação manual S13 e consumidores externos/colunas/DV S14 continuam abertos.

O plano [2026-09-23 — Alinhamento entre apresentação, documentação e código](../archive/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md) foi concluído e arquivado.
O plano [2026-09-23 — Issue 710: consolidação serviço a serviço](../archive/plans/2026-09-23-issue-710-consolidacao-service-a-service.md) foi concluído e arquivado.
O plano [2026-09-17 — Unificação de B/Ls, carga mista e Manifesto Mercante](../archive/plans/2026-09-17-unificacao-bls-carga-mista-e-manifesto-mercante.md) foi concluído e arquivado.
O plano [2026-09-20 — Remediação das auditorias marítimas (PR 706)](../archive/plans/2026-09-20-remediacao-auditorias-maritimas.md) foi concluído e arquivado.
O plano [2026-09-20 — Remediação da fronteira de segurança do Portal](../archive/plans/2026-09-20-remediacao-fronteira-seguranca-portal.md) foi concluído e arquivado.
O plano [2026-09-20 — Remediação de clientes, revisão e comunicação](../archive/plans/2026-09-20-remediacao-clientes-revisao-comunicacao.md) foi concluído e arquivado.
O plano [2026-09-12 — Transição de marca: Transhipping Desk → Vela](../archive/plans/2026-09-12-plano-transicao-marca-vela.md) foi concluído e arquivado (PR #688).
O plano [2026-09-03 — Issue 609: contatos e caixas de comunicação](../archive/plans/2026-09-03-issue-609-contatos-caixas-comunicacao.md) foi concluído e arquivado.

## Atualização do ciclo de vida — 2026-09-25

Por confirmação do responsável pelo Vela, os planos de governança das skills,
da revisão sistemática multiagente e da auditoria do Portal/F12 foram
concluídos e movidos para [`../archive/plans/`](../archive/plans/). O plano
Cloudflare permanece vivo, assim como a remediação das auditorias #654–#660.

## Revisão do ciclo de vida — 2026-09-19

Naquela revisão, os planos #654–#660, da revisão sistemática e de governança
das skills ainda continuavam vivos: o primeiro exigia prova de runtime; o
segundo mantinha C4/D4/D6 abertos; e o terceiro mantinha a validação no
Alienware e o encerramento pendentes. Nenhum foi arquivado apenas por ter
grande parte implementada.

As notas de execução intermediária de agosto/setembro foram preservadas no
[registro histórico](../archive/reports/2026-09-18-notas-historicas-indice-planos.md).

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da tabela acima.
3. Se a spec originária estiver em `docs/spec/`, movê-la para `docs/archive/specs/`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.
