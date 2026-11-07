# 0132 — Gravidade do alerta trocada na tela Regras de alertas, pelo Administrativo

Status: aceito — 2026-11-06 (pedido do dono). Implementada na migration `612`
e na tela **Regras de alertas** (`/alertas/regras`).

## Contexto

A gravidade de cada tipo de alerta (**Crítico** ou **Normal**) vive em
`alert_type_catalog.severity` e só mudava por migration: a `467` fez Crítico a
Fatura desatualizada depois da reunião de testes de 2026-10-26. A gravidade não
é enfeite. Ela decide:

- a ordem da fila de Alertas (os críticos vêm primeiro) e o cartão **Críticos**;
- a entrega quando o setor responsável não tem ninguém ativo: o crítico vai ao
  Administrativo; o normal não vai a ninguém e fica em Admin › Falhas de
  entrega de alertas (`fanout_alert_item_for_department`).

Em 2026-11-06 o dono pediu duas coisas sobre a tela **Regras de alertas**:
trocar a gravidade de um alerta ali mesmo, sem esperar uma migration, e tornar
a tela didática, sem migration, função, tabela ou rotina técnica nos textos. A
mesma conversa pediu a revisão da cobertura dos alertas no fluxo de trabalho
([relatório de 2026-11-06](../archive/audits/2026-11-06-cobertura-dos-alertas-no-fluxo-de-trabalho.md)),
e várias brechas achadas nela são de gravidade que não acompanha o peso do
fato, o que a troca pela tela permite ajustar sem código.

## Decisão

1. **Quem troca.** Só o Administrativo (e a conta Dev, que é do
   Administrativo): `set_alert_type_severity(tipo, gravidade, motivo)` recusa
   os outros setores com 42501. Na tela, a permissão é `manage_alert_rules`.
   Os outros setores veem a gravidade vigente e a última troca.
2. **Com motivo.** O motivo é obrigatório (10 caracteres ou mais) e fica em
   `audit_logs` (`alert_type`, campo `severity`, com a gravidade anterior e o
   autor), lido em Admin › Histórico de ações, assunto **Alerta**.
3. **O que muda.** A troca vale para o tipo no catálogo e para os alertas
   ativos dele, na mesma transação; os próximos alertas já abrem com a nova,
   porque `upsert_alert_item` grava a gravidade do catálogo. Os alertas
   resolvidos guardam a gravidade que tinham. As notificações do sino já
   entregues não mudam, e a troca não avisa ninguém de novo: um alerta que
   passa a Crítico com o setor sem ninguém ativo não é reentregue ao
   Administrativo; o próximo, sim.
4. **Gravidade de fábrica.** A que as migrations semeiam continua no
   catálogo da tela (`alertRulesCatalog.ts`), que a mostra como
   **Gravidade de fábrica** ao lado da vigente. Os testes de contrato comparam a
   de fábrica com as migrations; a vigente é lida do banco por
   `list_alert_type_settings()`.
5. **Tela didática.** Os textos da tela falam a língua de quem opera e seguem
   o capítulo 20 do Manual do Operador: a lista é agrupada pelos assuntos dele, e
   cada regra diz o que é, **Se ninguém agir**, quando abre e fecha, quem
   recebe (e quem age, quando não é o setor avisado), como resolver e a
   gravidade. A origem técnica de cada regra fica nos comentários do catálogo.
   `AlertasRegrasCatalog.test.tsx` recusa vocabulário técnico nos textos.

## Alternativas consideradas

- **Continuar por migration.** Mantém a gravidade revisada em PR, mas cada
  ajuste de prioridade da operação vira uma entrega de código. Recusada pelo
  pedido do dono.
- **Gravidade por equipe ou por registro.** Cada setor escolheria a sua, ou
  cada alerta aberto teria a própria. Recusada: a fila é uma só para todas as
  equipes, e duas gravidades para o mesmo tipo confundem o cartão Críticos
  (a `467` já evitava misturar as duas no mesmo tipo).
- **Todo setor troca.** Recusada: a gravidade muda a entrega ao Administrativo
  quando o setor responsável está vazio, que é decisão de quem administra o
  sistema.

## Consequências

- Uma migration que mude a gravidade de um tipo passa por cima da escolha
  feita na tela. Quem a escreve confere `audit_logs` (`entity_type =
  'alert_type'`) e diz no cabeçalho se respeita a troca.
- O capítulo 20 do Manual do Operador marca "· crítico" pela gravidade de
  fábrica; a vigente é a da tela, e o manual diz isso.
- `ponytail:` um `upsert_alert_item` que leu o catálogo antes da troca e grava
  depois dela devolve a gravidade antiga a um alerta aberto; a próxima
  atualização dele (o detector de 15 minutos, nos de prazo) corrige. Se pesar,
  o upsert passa a ler o catálogo com `FOR SHARE`.
- A matriz de permissões ganha a linha "Trocar a gravidade de um alerta"
  ([Segurança](../operations/seguranca.md#modelo-de-permissões-por-perfil)),
  provada na bateria por perfil (P14).

## Onde está a regra

[Operação e Suporte § `/alertas/regras`](../modules/operacao-suporte.md#alertasregras);
[Manual do Operador, capítulo 20](../manual/texto/20-alertas.md).
