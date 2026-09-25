# 0009 — Hard delete controlado com bloqueios fiscais e auditoria

Status: aceito — 2026-06-09

> **Nota editorial — 2026-09-24.** Supersedida parcialmente pela
> [ADR 0071](./0071-ce-mercante-como-trava-de-exclusao.md): o critério de
> exclusão passa a ser a trava do CE Mercante, o papel autorizado é o
> Administrativo e a auditoria deixa de ser best-effort. A rejeição de soft
> delete generalizado continua. Implementada em 2026-09-25 (nota da 0071).

## Contexto

O sistema precisa permitir correções operacionais em produção: excluir B/Ls, containers, veículos e clientes criados de forma indevida, inclusive em massa. Ao mesmo tempo, há histórico fiscal e financeiro que não pode desaparecer por cascata acidental.

Soft delete adicionaria estados novos a todas as listagens e relatórios; hard delete é mais simples para limpar erro operacional, mas é irreversível.

## Decisão

Permitir hard delete apenas de entidades operacionais sem bloqueadores fiscais, com UI somente para admin, RLS de delete somente admin, pré-checagem de dependências e auditoria best-effort.

- Apenas usuários admin veem e executam exclusões nas telas.
- Policies de banco devem manter `DELETE` restrito a `is_admin()`.
- Dependências operacionais podem ser removidas em cascata controlada pelo service, em ordem bottom-up.
- Dependências fiscais bloqueiam a exclusão: invoices, vínculos de invoice, recebíveis, Demurrage emitida e lotes/ledger relevantes.
- Para `voyages`, a exclusão só é autorizada quando não existe nenhum dado nas colunas `voyage_id` ou `anchor_voyage_id`; o trigger `trg_guard_voyage_hard_delete` faz essa última verificação no banco.
- Services como `deleteVehicles`, `deleteContainers`, `deleteBls` e `deleteCustomers` fazem pré-checagem e retornam relatório de bloqueados/deletáveis.
- Cada exclusão registra `audit_logs` via `logDeletions` quando há autor conhecido. Falha de auditoria é reportada como telemetria best-effort e não reverte a exclusão.

## Consequências

- **Positivas**: operadores admin corrigem dados operacionais errados; histórico fiscal continua protegido; exclusão em massa pode seguir parcialmente quando alguns itens são bloqueados.
- **Negativas / custos**: hard delete depende de backup/PITR para recuperação; auditoria best-effort pode falhar sem interromper a ação; mensagens de bloqueio precisam continuar claras por entidade.
- **Alternativa descartada**: soft delete generalizado nesta etapa. Ele exigiria revisar queries, relatórios, imports, contagens e faturamento para filtrar `deleted_at`, ampliando muito a superfície de mudança.
