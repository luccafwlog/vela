# ADR 0024: Cancelamento de Viagem é Estado Retido; Exclusão é Hard Delete

Status: aceito

Data: 2026-07-10

> **Nota editorial — 2026-09-24.** Supersedida parcialmente pela
> [ADR 0071](./0071-ce-mercante-como-trava-de-exclusao.md): viagem com B/Ls
> sem CE Mercante passa a ser excluível em cascata, com prévia, e viagem
> cancelada por engano pode ser reativada pelo Administrativo. O cancelamento
> continua estado retido. Implementada em 2026-09-25 (nota da 0071).

> **Nota editorial — 2026-09-20.** A decisão foi confirmada durante a revisão
> da PR 706: `voyages` continua sem estado `deleted`, mas um Administrador pode
> fazer hard-delete de uma viagem não cancelada quando ela ainda não possui
> qualquer dado vinculado. O banco aplica a regra no trigger
> `trg_guard_voyage_hard_delete`, cobrindo `voyage_id` e `anchor_voyage_id`;
> viagens canceladas permanecem retidas mesmo que não tenham outro vínculo.

## Contexto

O status `cancelled` de uma viagem havia sido omitido de alguns filtros e uma
alteração de ATD podia recalcular o status para `active` ou `completed`.
Isso confundia cancelamento com exclusão e apagava a intenção operacional
registrada ao cancelar.

## Decisão

- Tratar `cancelled` como estado retido de `voyages`. No Painel, o filtro
  padrão permanece em viagens ativas e canceladas aparecem em `Canceladas` ou
  `Todas`; em Viagens, o filtro padrão `Todas` também inclui canceladas.
- Impedir que a sincronização automática após alteração de ATD modifique uma
  viagem já cancelada.
- Manter exclusão como hard delete controlado, sujeito aos bloqueios de
  dependências já definidos pela ADR 0009; não há status `deleted` de viagem.

## Consequências

O Line-Up e o rail de Viagens devem conservar a opção de filtro `cancelled`.
Automatismos de agenda continuam calculando apenas `active` e `completed` para
viagens não canceladas. Recuperar uma viagem cancelada exige ação explícita que
altere seu status; não é efeito colateral de agenda.
