# Lote da reunião de testes de 26/10

Data: 2026-10-27. Origem: reunião de testes do Vela de 2026-10-26 (sete pontos,
reorganizados aqui em quatro blocos). Decisões do dono em 2026-10-27, listadas
abaixo.

## Estado

Executado em 2026-10-27 na branch `claude/tender-rubin-xxf52l`, um commit por
bloco, na ordem deste plano: bloco 1 (migration `466`), bloco 2 (migration
`467`), bloco 3 (só tela) e bloco 4 (migration `468`). Arquivado no mesmo
change. Verificado no Postgres 16 local (todas as migrations aplicadas e as
suítes local-pg) e nos checks do [AGENTS.md](../../../AGENTS.md); não aplicado em
produção, o que acontece depois do merge na `main`.

Diferenças do executado em relação ao planejado:

- **Bloco 4, onde se declara:** a declaração "Esta viagem não terá veículos"
  ficou só na tela Veículos (estado vazio da viagem), para onde o alerta leva;
  as ações de importação da Viagem continuam só com "Importar veículos".
- **Bloco 4, registro:** tabela própria `voyage_vehicle_declarations` (uma
  linha por viagem), lida pela tela por `voyage_vehicle_declaration`.
- **Bloco 4, destino do alerta:** o destino por item não é gravado (o gatilho
  do catálogo o limpa); `alertEntityLink` leva o tipo a `/veiculos?voyage=<id>`.
- **Tipos:** `src/types/database.ts` não foi regenerado. As RPCs novas são
  chamadas como `rpc('nome' as never)`, com a resposta conferida no serviço,
  como em `customerCommunications.ts`; a pendência de autorização caiu.

## Decisões do dono (2026-10-27)

1. **Prazo do Desbloqueio de CE:** requisitos cumpridos antes das 12:00
   (inclusive antes das 8h) vencem às 17:00 do mesmo dia útil; a partir das
   12:00, às **12:00** do próximo dia útil (era 12:30); sábado e domingo vencem
   segunda às 12:00, como hoje. Continua sem calendário de feriados.
2. **Fatura individual coberta:** o status continua `covered` ("Coberta") no
   banco, nos filtros, nas listas e no Vela. Muda só o detalhe da fatura no
   Portal Fwlog, que passa a dizer "Paga, coberta pela fatura X".
3. **Planilha de Veículos:** só o alerta. A emissão pelo CE continua como hoje;
   se o CE for vinculado antes da resposta de Equipamentos, a fatura sai e a
   correção segue a [ADR 0077](../../adr/0077-fatura-emitida-nao-muda-de-valor.md).

"Injeção" da ata é **isenção**: B/L de container com veículo em LCL é isento de
Taxas Locais ([Taxas Locais](../../modules/taxas-locais.md)); sem a planilha, o CE
vinculado emite a fatura cheia.

## Bloco 1 — Desbloqueio de CE: Portal e e-mails ao cliente (pontos 3, 4 e 7)

### 1.1 Prazo: 12:00 do próximo dia útil

**Hoje.** `ce_unlock_private.sla_deadline` (migration `161`) e
`src/services/ceUnlockSla.ts` dão 12:30 do próximo dia útil para início a partir
das 12:00 (D16 da spec arquivada
[2026-10-07](../specs/2026-10-07-desbloqueio-ce-revisao-fluxo-design.md)).

**Muda para.** 12:00 do próximo dia útil, nos dois lados. O prazo é calculado na
leitura, não gravado: as solicitações abertas e a medição das exportações
passadas passam a usar 12:00 (dados de teste, conforme o "Data status" do
`AGENTS.md`). O aviso "documentação validada" usa a mesma função e sai com o
horário novo.

- Migration nova: `CREATE OR REPLACE` de `ce_unlock_private.sla_deadline`.
- `ceUnlockSla.ts`: `AFTERNOON_DEADLINE` 12:00 e comentário do cabeçalho.
- Testes: `ceUnlockSla.test.ts` e a paridade SQL × tela citada em
  [Desbloqueio de CE § Prazo (SLA)](../../modules/desbloqueio-ce.md#prazo-sla).

### 1.2 Prazos visíveis no Portal

**Muda para.** Portal › Desbloqueio de CE › aba Nova solicitação, bloco "O que o
desbloqueio pede": logo abaixo das quatro exigências, uma linha fixa:
"Com os quatro requisitos cumpridos até as 12h, o desbloqueio é feito até as
17h do mesmo dia útil; depois das 12h, até as 12h do próximo dia útil." A linha
também diz que, cumpridos no sábado ou no domingo, o prazo é até as 12h de
segunda-feira (texto final na execução, com os mesmos números da regra).

- `src/pages/PortalDesbloqueioCe.tsx` (bloco `O que o desbloqueio pede`).
- Teste de tela em `src/pages/__tests__/PortalDesbloqueioCe.test.tsx`.

### 1.3 "Consulte o Mercante" passa a "Consulte o SISCARGA"

**Hoje.** A frase "Consulte o Mercante para verificar o desbloqueio" está no
aviso "documentação validada" (sino do Portal e e-mail, gravados por
`ce_unlock_private.notify`, migration `338`) e na situação da solicitação no
Portal (`PortalDesbloqueioCe.tsx`, linhas com "consulte o Mercante").

**Muda para.** "Consulte o SISCARGA para verificar o desbloqueio" nos três
lugares. Avisos já gravados ficam com o texto antigo.

- Migration nova: `CREATE OR REPLACE` de `ce_unlock_private.notify` (pode ser a
  mesma da 1.1).
- Comentário de `ceUnlockNoticeTemplate` em
  `supabase/functions/_shared/portalEmailTemplates.ts`.
- Testes: `ceUnlockNotifyEmail.test.ts` (inclui a asserção sobre o texto da
  migration) e `PortalDesbloqueioCe.test.tsx`.

### 1.4 Resposta e rodapé dos e-mails do Desbloqueio de CE: `importacao@fwlog.com.br`

**Hoje.** Os avisos do Desbloqueio de CE (correção solicitada e documentação
validada) saem com `PORTAL_REPLY_TO` = `suporte@portalfwlog.com.br` e o rodapé
leva `PORTAL_SUPPORT_EMAIL`. O Comunicado de CE Mercante e Taxas já usa
`importacao@fwlog.com.br` e não muda.

**Muda para.** "Responder" e o rodapé desses avisos vão para
`importacao@fwlog.com.br`, como os Comunicados.

- `supabase/functions/_shared/portalEmail.ts`: `replyTo` opcional em
  `SendPortalEmailInput` (padrão continua `PORTAL_REPLY_TO`).
- `supabase/functions/ce-unlock-notify-email/index.ts`: usa
  `COMMUNICATIONS_REPLY_TO` (secret que já existe, valor
  `importacao@fwlog.com.br`) no envio e na checagem `providerConfigured`, e
  `COMMUNICATIONS_CONTACT_EMAIL` no rodapé. Nenhum secret novo.
- E-mails de acesso ao Portal, Resumo diário e falha de entrega continuam com
  `suporte@portalfwlog.com.br`.
- Testes: `ceUnlockNotifyEmail.test.ts`, `emailsSemDominioAntigo.test.ts`.
- Docs: [Serviços externos](../../operations/servicos-externos.md) (tabela "Resposta
  vai para" e o parágrafo do ImprovMX) e
  [Desbloqueio de CE § Avisos ao cliente](../../modules/desbloqueio-ce.md#avisos-ao-cliente).

**Pronto quando** o prazo da tela e o do aviso batem nos mesmos casos com
12:00, o Portal mostra a linha dos prazos, nenhum texto ao cliente cita
"Mercante" como lugar de conferir o desbloqueio e o e-mail simulado sai com
reply-to e rodapé `importacao@fwlog.com.br`.

## Bloco 2 — Faturamento (pontos 2 e 5)

### 2.1 Portal: detalhe da individual coberta diz "Paga, coberta pela fatura X"

**Hoje.** Em Portal › Faturas, o detalhe da individual coberta mostra
"Coberta pela consolidada INV-X", o botão **Abrir INV-X** e "O pagamento e o
recibo são os da consolidada." (`PaymentSummary` em
`src/components/portal/PortalInvoiceDetailModal.tsx`).

**Muda para.** Dado principal "✓ **Paga** · coberta pela fatura INV-X", com a
forma e a data do pagamento da consolidada (ex.: "Pix em 26/10/2026"; mais de
uma forma, todas, separadas por vírgula). **Abrir INV-X** continua. Sem recibo
próprio, como hoje. Lista, filtro e situação na faixa continuam "Coberta"
([decisão de 2026-10-08](../../modules/faturamento.md), migration `162`).

- A forma e a data vêm do detalhe da consolidada, já autorizado para o mesmo
  Cliente: `usePortalInvoiceDetail(covered_by_invoice_id)` só quando a
  individual está coberta (`ponytail`: uma leitura a mais por abertura; se
  pesar, `portal_invoice_details` passa a devolver os pagamentos da
  consolidada). Sem a consolidada carregada, a linha mostra só "Paga · coberta
  pela fatura INV-X".
- Conferir o Modo Inspeção do Portal, que usa os wrappers `portal_inspect_*`.
- Teste do modal com a individual coberta (com e sem a consolidada carregada).
- Docs: [Portal do Cliente](../../modules/portal-cliente.md) (parágrafo "Detalhe da
  fatura de Taxas Locais") e a frase do Portal em
  [Faturamento](../../modules/faturamento.md) sobre `covered`.

### 2.2 Alerta "Fatura desatualizada" passa a Crítico

**Muda para.** `fatura_desatualizada` com gravidade **Crítico** na fila de
Alertas e no sino; os alertas abertos também.

- Migration nova: `UPDATE alert_type_catalog SET severity = 'critical'` e
  `UPDATE alert_items` dos ativos desse tipo (`upsert_alert_item` já lê a
  gravidade do catálogo). O cabeçalho cita o "Data status" do `AGENTS.md`,
  exigido por `npm run migrations:check` para migration que reescreve linhas.
- `src/services/alertRulesCatalog.ts`: `severity: 'critical'`.
- Docs: [Operação e Suporte](../../modules/operacao-suporte.md), se citar a
  gravidade.

**Pronto quando** o cliente vê "Paga, coberta pela fatura X" no detalhe da
individual coberta e a fila de Alertas mostra Fatura desatualizada como
Crítico.

## Bloco 3 — Viagem › Rotas e Manifestos (ponto 1)

**Hoje.** A rota com omissão aparece como `CNNSA → ~~BRSSA~~ → BRVIX · Omissão`
(`VoyageManifestosTab.tsx`; rótulo em `voyageCardHelpers.tsx`).

**Muda para.**

- Transbordo (grupo com o POD omitido):
  `CNNSA → ~~BRSSA~~ (Omitida) → BRVIX (Transbordo) → BRSSA (Destino Final)`.
- COD (grupo com POD no Porto de Transbordo):
  `CNNSA → ~~BRSSA~~ (Omitida) → BRVIX (Destino Final)`.
- Só o código do porto omitido é riscado; "(Omitida)" não. O " · Omissão" sai,
  porque a rota já diz. A seta `→` da tabela continua.
- O rótulo de texto (`routeLabel`, usado no `title`, no `aria-label` e nos
  botões da linha) segue o mesmo formato, sem o risco.

- Testes do helper e da aba para os dois casos.
- Docs: [Viagens](../../modules/viagens.md) (aba Rotas e Manifestos).

**Pronto quando** as duas rotas aparecem como acima numa viagem com omissão,
uma com B/L em transbordo e outra com B/L em COD.

## Bloco 4 — Alerta para Equipamentos: planilha de Veículos (ponto 6)

**Comportamento.**

- Alerta novo **Planilha de Veículos pendente** (tipo sugerido
  `voyage_vehicle_sheet_pending`), um por Viagem, para **Equipamentos**,
  Crítico, como o CE Mercante pendente.
- Abre em D-5 do primeiro ETA brasileiro (`get_voyage_first_brazilian_eta`, a
  mesma janela de `voyage_ce_mercante_missing`), em Viagem não cancelada com ao
  menos um B/L ativo de container ou misto com POD numa escala elegível
  (`get_voyage_eligible_pods`); a planilha de Veículos só casa veículo com B/L
  e container.
- Fecha sozinho quando a Viagem tem ao menos um veículo importado ou quando
  alguém declara **"Esta viagem não terá veículos"**. Também fecha quando a
  Viagem é cancelada ou fica sem B/L de container, como os outros alertas de
  viagem (migration `346`).
- **Resolver** leva a `/veiculos?voyage=<id>`, onde ficam as duas saídas:
  **Importar veículos** (o fluxo atual) e **Esta viagem não terá veículos**,
  com confirmação. A mesma declaração fica nas ações de importação da Viagem
  (`VoyageImportActions`).
- A declaração grava quem e quando, aparece na Linha do Tempo da Viagem e pode
  ser desfeita com motivo (**Desfazer declaração**); desfeita dentro da janela,
  o alerta reabre. Qualquer usuário interno ativo declara, como quem importa
  veículos.

**Banco.**

- Migration nova: registro da declaração na Viagem (colunas em `voyages` ou
  tabela própria, decidido na execução), RPC de declarar/desfazer com
  `changed_by = auth.uid()`, usuário ativo e auditoria; entrada em
  `alert_type_catalog` (`critical`, `equipamentos`, audiência
  `['equipamentos']`); `reconcile_voyage_vehicle_sheet_alerts(p_voyage_id,
  p_source)`, chamado por `reconcile_voyage_operation_alerts` (detector de 15
  minutos, que cobre a virada do dia), por `reconcile_inactive_voyage_alerts`,
  pela reconciliação de B/L da viagem e por gatilho em `vehicles`
  (inserir, mover, excluir) e na declaração.
- Teste local-pg novo (`alertaPlanilhaDeVeiculos.local-pg.test.ts`): abre em
  D-5 sem veículo nem declaração; não abre antes de D-5 nem sem B/L de
  container; fecha com veículo, com declaração, com cancelamento; reabre ao
  desfazer.

**Aplicação.**

- `src/services/alertRulesCatalog.ts` e rótulo em `src/services/alerts.ts`.
- Serviço e hook da declaração em `src/services/`/`src/hooks/`, com a
  invalidação de Viagem, Veículos e Alertas em `cacheEffects.ts`.
- `src/pages/Veiculos.tsx` e `src/components/shared/VoyageImportActions.tsx`.
- `src/types/database.ts` para a RPC nova: arquivo protegido, **regenerar exige
  autorização explícita do dono** (ver Pendências).
- Docs: [Operação e Suporte](../../modules/operacao-suporte.md) (parágrafo do
  alerta), [Manifestos & EDI § /veiculos](../../modules/manifesto-edi.md#veiculos),
  [Viagens](../../modules/viagens.md) (Linha do Tempo) e
  [RASTREABILIDADE](../../RASTREABILIDADE.md).

**Pronto quando** uma viagem com B/L de container entra em D-5 sem veículos e
Equipamentos vê o alerta crítico; declarar "sem veículos" ou importar a
planilha fecha o alerta, e a declaração aparece na Linha do Tempo da Viagem.

## Fora de escopo

- Segurar a emissão da fatura até a resposta de Equipamentos (decisão 3).
- Calendário de feriados no prazo do Desbloqueio de CE.
- Mudar o status "Coberta" no Vela, nas listas ou nos filtros do Portal.
- Trocar o endereço dos e-mails de acesso ao Portal.

## Pendências

Nenhuma. Confirmar depois do deploy, em produção: o secret
`COMMUNICATIONS_REPLY_TO` presente para a função `ce-unlock-notify-email`
(sem ele, o envio real do aviso responde 503).

## Verificação

Por bloco, os checks de [WORKFLOW.md](../../../WORKFLOW.md) §11 conforme o
[AGENTS.md](../../../AGENTS.md): `npm run docs:check`, `npm run typecheck`,
`npm run lint`, `npm test` e `npm run build`; com migration,
`npm run migrations:check` e `npm run rpc:check`; nas telas,
`npm run design:check` e `npm run a11y:contrast`; os testes local-pg do
Desbloqueio de CE e do alerta novo no Postgres local. Migration local não prova
deploy: a aplicação em produção acontece depois do merge na `main`.

## Riscos e rollback

- Prazo: rollback é recriar `sla_deadline` com 12:30 (corpo da `161`) e voltar
  a constante da tela; os dois lados precisam mudar juntos, ou o Portal e o
  e-mail mostram horários diferentes.
- Reply-to: sem `COMMUNICATIONS_REPLY_TO`, o envio real do aviso é recusado com
  503 (como hoje sem `PORTAL_REPLY_TO`); conferir o secret antes do merge.
- Alerta novo: o detector roda a cada 15 minutos; um erro nele é isolado em
  subtransação (migration `351`) e não para os demais.

## Ao concluir

Mover este plano para `docs/archive/plans/`, tirar a linha de
`docs/plans/README.md`, registrar no [CHANGELOG](../../CHANGELOG.md) e rodar
`npm run docs:check`.
