# 0107 — Sino só do setor responsável, e alerta resolvido sai do sino

Status: aceito — 2026-10-27 (decisão do dono, ponto 2 de
[Pontos do dono](../manual/decisoes/pontos-do-dono.md), com a exceção do
Financeiro decidida em 2026-10-27; lote 8 do
[plano de correções](../plans/2026-10-27-correcoes-decididas-pelo-dono.md)).
Implementada na migration `476`.

Supersede parcialmente a [ADR 0034](./0034-notificacao-interna-separada-do-alerta-sino-entrega-alertas-trata.md)
(audiência e permanência da notificação) e o item 24 da
[ADR 0083](./0083-decisoes-da-revisao-geral-da-documentacao.md) (audiência é
o catálogo mais o setor do item). Mantém o P5 da
[ADR 0085](./0085-modelo-de-permissoes-por-perfil.md) (item D18).

## Contexto

A Notificação Interna ia à audiência do catálogo
(`alert_type_catalog.audience_departments`) mais o setor do item. Em vários
tipos a audiência tinha setor que não trata o alerta: o Pix sem conciliação
segura avisava Documentação e Equipamentos; as datas de escala e de terminal
pendentes avisavam Documentação; a Revisão de B/L com Portal não provisionado
avisava o Administrativo. O sino enchia de avisos que a pessoa não resolve.

A notificação também ficava no sino e no número de não lidas até a pessoa
marcar como lida, mesmo com o alerta já resolvido.

## Decisão

1. O sino entrega só ao **setor responsável** do item
   (`alert_items.department`; sem ele, o responsável do catálogo).
2. **Exceção do Financeiro** (decidida pelo dono em 2026-10-27): os quatro
   tipos que tinham o Financeiro na audiência — PIX sem conciliação segura,
   Consulta de Pix do Itaú parada, Restituição pendente e Fatura desatualizada
   — continuam avisando também o Financeiro. Mantém o P5 da ADR 0085.
3. Alerta crítico sem ninguém ativo nesses setores continua indo ao
   Administrativo (fallback crítico).
4. A audiência do catálogo passa a dizer o mesmo que a entrega: o
   responsável e, nos quatro tipos, o Financeiro.
5. A notificação conta no sino e no número só enquanto o item dela está
   ativo, na mesma ocorrência. Resolvido (pela origem ou por justificativa),
   sai sem a pessoa marcar como lida; reaberto, volta pela notificação nova
   (`_internal_notification_is_current`, usado por
   `list_internal_notifications` e `count_unread_internal_notifications`).

## Consequências

- Pix deixa de avisar Documentação e Equipamentos; "Data da escala pendente" e
  "Data de terminal pendente" deixam de avisar Documentação; "Revisão de B/L —
  Portal não provisionado" deixa de avisar o Administrativo; os tipos de
  contato e Portal que avisavam Documentação e Administrativo avisam só
  Documentação.
- Os dois tipos do ADR continuam com um item por departamento; cada setor
  recebe o aviso do próprio item.
- Regras de alertas mostra um só setor responsável por regra, com o
  Financeiro como "também recebe" nos quatro tipos.
- As notificações entregues continuam guardadas (cópia congelada); só deixam
  de aparecer no sino e no número.
