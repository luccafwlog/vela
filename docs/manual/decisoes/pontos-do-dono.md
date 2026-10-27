# Pontos do dono fora das fichas

Decisões que o dono trouxe em 2026-10-27 depois de decidir as 112 fichas. Cada uma vira
tarefa própria, junto com as fichas; as que mudam regra pedem ADR nova. O
manual descreve o que o sistema faz até a correção sair.

## 1. Fila de Alertas para todos — confirmado, sem mudança

Combinado com o time: todos veem todos os alertas em `/alertas`, de qualquer
setor. Conferido no código (leitura, sem execução): `list_alert_queue_page`,
`count_alert_queue` e `summarize_alert_queue_by_department` (migration `002`)
só exigem usuário ativo; a tela abre em "Todos os setores"; dispensar e
resolver não olham o setor. Os cartões do Painel abrem a fila já filtrada
pelo setor do cartão.

## 2. Sino só com o que é do setor, e alerta resolvido sai do sino

- **Hoje:** `fanout_alert_item` (migration `328`) entrega à audiência do
  catálogo (`alert_type_catalog.audience_departments`), que em 5 dos 50 tipos
  inclui setor que não é o responsável: Revisão de B/L — Portal não
  provisionado (+Administrativo), Consulta de Pix do Itaú parada
  (+Financeiro), PIX sem conciliação segura (+Documentação, +Equipamentos),
  Data da escala pendente e Data de terminal pendente (+Documentação). A
  notificação fica no sino e conta como não lida até a pessoa marcar como
  lida, mesmo com o alerta resolvido (`list_internal_notifications` e
  `count_unread_internal_notifications`, migration `002`, não olham o item).
- **Decidido:** o sino entrega só ao setor responsável pelo item (o
  `alert_items.department`). O alerta resolvido, pela origem ou com
  justificativa, sai do sino e do número sem a pessoa marcar como lido.
  O sino é por setor: o sistema não designa alerta a uma pessoa.
- **Em aberto:** alerta crítico sem ninguém ativo no setor responsável hoje
  vai ao Administrativo (rede de segurança). Recomendação: manter.
- Afeta também a matriz de Admin › Usuários ("Recebe os alertas do próprio
  setor", `src/services/permissionMatrix.ts`) e a tela de Regras dos alertas
  (`src/services/alertRulesCatalog.ts`, `notifiedDepartments`).

## 3. Retirar a dispensa de alerta

- **Decidido:** o time concordou que dispensar alerta não é útil e pode ser
  prejudicial. A ação Dispensar sai do sistema.
- **O que sai ou muda:** botão Dispensar e janela em `/alertas`
  (`src/pages/Alertas.tsx`), cartão e lente Dispensados, coluna "Dispensado
  até"; `dismiss_alert_item` (migration `441`) e o Eco de Tratamento da
  dispensa; `dismissed_count` no resumo por setor e o detalhe "N dispensados"
  nos cartões do Painel (`src/pages/Painel.tsx`); o filtro `dismissed` das
  RPCs da fila; o texto "Pode ser dispensado temporariamente…" das 50 regras
  em `alertRulesCatalog.ts`; o tópico de dispensa no manual. O histórico
  (`alert_item_dismissals`) fica guardado. As fichas ALE-D07 (motivo curto
  na dispensa) e a parte de dispensa da ALE-D18 deixam de valer.
- **Em aberto:** (a) dispensas vigentes no dia da mudança: recomendação é o
  alerta voltar a Ativos na hora; (b) tipos cuja origem a equipe não consegue
  corrigir (saúde de rotina, provedor de e-mail, Pix de fora do Vela) ficariam
  abertos para sempre: mapear esses tipos na tarefa e, onde não houver saída,
  dar a eles "Resolver com justificativa".
- Afeta o ponto 2: sem dispensa, deixa de existir a pergunta de o alerta
  dispensado sair do sino.
