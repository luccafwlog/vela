# Revisão de Demurrage: telas, elegibilidade e relatórios

> Registro histórico de 2026-10-29: descreve a `staging` em `8e0ce0b` e não é a regra vigente. As decisões do dono sobre estes achados estão na [ADR 0112](../../adr/0112-repaginacao-da-demurrage.md), com o [plano](../../plans/2026-10-29-repaginacao-da-demurrage.md).

**Data:** 29/10/2026
**Base:** `staging` em `8e0ce0b` (`claude/magical-curie-cl20fl` = ponta da staging), por pedido do Lucca no meio da revisão. Comparei com a `main` em `4ff344e`.
**Escopo:** somente leitura. Nenhuma escrita em produção ou staging; nenhum e-mail; nada do Itaú real.

## Como ler a evidência

| Rótulo | O que prova |
|---|---|
| **Código** | Leitura do código na `staging` `8e0ce0b`; as linhas citadas são dessa revisão. |
| **SQL** | Leitura da última definição da função na cadeia ativa (`001`–`510`). Não uso `migrations_archive/` nem `GRANT`/`REVOKE` do `002`. |
| **Runtime local** | Postgres 16 descartável (`scripts/setup-local-pg.sh --reset`) com as **504** migrations da `staging`, em 29/10/2026. |
| **Suspeita** | Não verificada. Digo o que falta conferir. |

Sobre o **Runtime local**:

- Montei um dataset sintético com o prefixo `QV-*` / `QVCU77*` e mexi nele pelas RPCs reais, como Administrativo, como usuário do Portal e como `service_role`.
- A tela foi reproduzida com as **funções reais do front** sobre um retrato JSON do banco: `listDemurrageContainers`, `blBillingState`, `effectiveDemurrage`, `listCustomerContainers`, `customerContainerView` e a réplica literal dos filtros de `DemurrageContainersTab.tsx:109-157`. Para isso usei um cliente Supabase falso, só de leitura.
- Não usei navegador nem PostgREST, e não testei RLS por papel, salvo onde digo o contrário.
- O job diário foi simulado chamando `refresh_containers_demurrage_status()`.

Três revisões auxiliares, só de leitura, cobriram Relatórios, Portal e Disputas/Alertas/Conciliação. Conferi no código cada ponto delas que virou achado. Reproduzi no banco a Disputa presa, o filtro "Vencidas" sempre vazio e o B/L sem CE.

### `main` × `staging` neste escopo

Quase tudo vale para as duas. As diferenças de Demurrage são três:

1. **Migration `504`.** `set_container_dates` recusa a data de container de B/L cancelado ("B/L … cancelado: somente leitura. Reative para corrigir."). Na `main`, a chamada terminava sem erro e a data ia só para os B/Ls irmãos, ou para lugar nenhum. A seção Demurrage da ficha do B/L também fica só leitura no B/L cancelado (`BlDemurrageSection.tsx:236, 306-308, 343-346`).
2. **ROE manual no grupo.** `readDemurrageGroupAnchor` (`demurrageContainers.ts:253`) e o bloco ROE manual da ficha do B/L (`BlManualRoe.tsx`) só oferecem **Definir/Trocar ROE manual…** no B/L que emite a Invoice do grupo.
3. **Migration `509`.** Recria `issue_demurrage_invoice_for_bl`, `create_demurrage_invoice_authoritative`, `cancel_demurrage_invoice`, `register_demurrage_payment`, `apply_demurrage_discount`, `reverse_demurrage_payment`, `save_bl_demurrage_config` e outras. Comparei os corpos de `main` e `staging` sem os textos entre aspas: **só as mensagens mudaram**. Na lógica, valem as definições anteriores (`472`, `214`, `191`, `246`, `357`, `446`…).

Em `demurrageContainers.ts`, as linhas a partir da 247 andaram 11 posições: o que está em `:258` na `staging` está em `:247` na `main`.

**Rota do Portal.** O mapeamento prévio cita `/portal/faturas?tab=demurrage`, que **não existe**. A rota é `/portal/billing?tab=demurrage` (`src/AppPortal.tsx:82`); qualquer outra cai em `/portal` (`:91`). O doc já está certo (`docs/modules/demurrage.md:405`).

---

## 1. Veredito executivo

**A central de Demurrage ainda não está segura para ser a única fonte da operação diária.**

O que ela calcula e cobra está correto:

- free time;
- dias;
- P1 e P2;
- cobrança por caixa;
- complementar;
- reemissão por datas;
- recálculo pela PTAX;
- congelamento no pagamento.

O problema está em **quem aparece, com que rótulo e por quanto tempo**. A aba Containers mostra só o que o banco já gravou como `overdue` ou `returned`, e esse status não acompanha todas as mudanças. A tela também oferece **Gerar Invoice** em casos que o banco sempre recusa. Já os relatórios e a aba Por Cliente olham só para Invoices, então a exposição ainda não faturada não aparece em nenhum total.

**Não achei P0 no sentido estrito**, ou seja, um container em atraso que nunca apareça em superfície nenhuma. Em todos os casos a ficha do B/L e a aba Contêineres da ficha do Cliente mostram o cálculo. Mas há caminhos em que **o container some da central, dos cartões e do cabeçalho**, e um caminho em que **a cobrança se perde sem aviso** (risco 4).

### Top 5 riscos

1. **Tipo de container sem tarifa corre sem aparecer na central (P1).**
   - Enquanto está fora, o banco grava `within_free_time` para sempre, porque sem free time não há como vencer: `_container_demurrage_status`, `211:180-187`; `ponytail:` em `197`.
   - Fica fora da aba Containers, do cartão **Containers em atraso** e do aviso do cabeçalho.
   - Devolvido, aparece com **"Nada a cobrar"** na linha do B/L. O erro "sem tarifa" só aparece ao abrir a linha, e o valor fica fora de "a faturar (previsto)".
   - A emissão é recusada. Não há Alerta.
   - Cenário 14. **Runtime local.**
2. **Exposição não faturada invisível fora da aba Containers (P1).**
   - **Por Cliente**, **Aguardando pagamento**, **CustomerSummaryReport** e `/relatorios?visao=demurrage` só leem Invoices. Não existe relatório nem exportação de containers em atraso ou devolvidos sem Invoice.
   - No dataset, três Clientes com sobreestadia correndo ou a faturar **não aparecem em Por Cliente**.
   - Cenários 2, 4 e 15. **Runtime local.**
3. **A tela diz "A faturar" para o que o banco não deixa faturar (P1, a tela mente).**
   - A linha mostra **"A faturar"** com **Gerar Invoice**, e soma o valor em "a faturar (previsto)", para:
     - B/L **cancelado** com container devolvido;
     - B/L **sem Cliente**;
     - B/L **sem CE Mercante** ou com o **Gate de faturamento do Portal** fechado.
   - O banco recusa os três. A fila de efeitos encerra o caso sem CE como `succeeded`, com resultado `blocked`, e não abre Alerta.
   - Na ficha do B/L, a caixa **já paga** aparece como **"a faturar"**, e o B/L que não é âncora diz **"nenhuma fatura de Demurrage"** com a caixa cobrada na Invoice do outro B/L.
   - Cenários 4, 7, 8, 12 e 13. **Runtime local.**
4. **B/L cancelado com sobreestadia sem Invoice: cobrança perdida em silêncio (P1, depende de decisão).**
   - `cancel_bl` só recusa com Invoice de Demurrage **em aberto**. Ele aceita o B/L com container devolvido com sobreestadia e ainda sem Invoice, inclusive quando a emissão estava parada por falta de CE.
   - Depois disso nenhuma Invoice pode sair (`issue_demurrage_invoice_for_bl` recusa B/L cancelado), e a aba Containers continua dizendo "A faturar".
   - Cenário 12c. **Runtime local.**
5. **Atraso real fica até cerca de 24 h fora da central (P2), e Disputa presa (P1).**
   - **Status defasado.** Diminuir o free time do B/L, desativar ou trocar o acordo do Cliente, criar a tarifa de um tipo novo ou trocar o Cliente do B/L **não recalcula** `demurrage_status`. Só o job `container-demurrage-status` faz isso, às 00:17 de Brasília (`17 3 * * *` UTC). Até lá, o container em atraso não aparece na central, embora a ficha do B/L já mostre "em curso" (cenário 3).
   - **Disputa presa.** Cancelar a Invoice com Disputa aberta deixa a Disputa **aberta para sempre**:
     - o Cliente recebe "Fatura de demurrage não encontrada";
     - a equipe responde uma vez e depois recebe "A Dispute aguarda manifestação do cliente";
     - a Disputa continua contando em **Disputas aguardando resposta**.

     Cenário 11. **Runtime local.**

---

## 2. Mapa confirmado das telas, das abas e da elegibilidade

### 2.1 Quem entra em cada superfície (A1)

**Universo.** Todo `bl_containers`, com ou sem descarga, de B/L ativo ou cancelado e de Viagem ativa ou cancelada. Também as Invoices em `demurrage_invoices`.

- `bls.voyage_id` é **NOT NULL**, então "B/L sem Viagem" não existe no schema. **Runtime local:** `information_schema`.
- `bls.customer_id` aceita nulo.

**Valores de `demurrage_status`.** O CHECK é `bl_containers_demurrage_status_check`; o padrão é `within_free_time`. Os valores e quem grava cada um:

- `within_free_time`:
  - o gatilho `trg_container_demurrage_status_semantics` (migration `197`, função `211`), em INSERT e em UPDATE de `return_date`, `discharge_date`, `demurrage_status`, `type`, `bl_id` e `ownership`;
  - o job `refresh_containers_demurrage_status()` (`200`);
  - o gatilho de cancelamento ou reativação de B/L e Viagem `refresh_demurrage_status_on_cancellation` (`200`);
  - para SOC, sempre (`121`).
- `overdue`: o mesmo gatilho e o mesmo job, quando `(hoje em São Paulo) − descarga > free time` (`211:185`; B/L ou Viagem cancelados devolvem `within_free_time`, `211:174-179`).
- `returned`: o mesmo gatilho, sempre que há devolução, **inclusive em B/L ou Viagem cancelados** (`211:168-170`).
- A RPC legada `update_container_demurrage_dates` recebe um status, mas o gatilho o normaliza, e `authenticated` não a executa desde a `211`.

**Legenda da tabela abaixo:**

- **T/A/D** = aba Containers nas lentes Todos / Em atraso / Devolvidos;
- **Fat/Pg/Can** = abas Faturas / Pagas / Canceladas;
- **PC** = Por Cliente;
- **KPI-a** = cartão Containers em atraso e aviso do cabeçalho;
- **KPI-p** = Aguardando pagamento;
- **Rel** = `/relatorios?visao=demurrage`;
- **FB** = ficha do B/L › Faturamento;
- **FC** = ficha do Cliente › Contêineres;
- **Portal** = `/portal/billing?tab=demurrage`.

| Fatia do universo | T | A | D | Fat/Pg/Can | PC | KPI-a | KPI-p | Rel | FB | FC | Portal |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Sem descarga | ✗ | ✗ | ✗ | — | ✗ | ✗ | — | ✗ | ✔ "Sem descarga" | ✔ | ✗ |
| Fora, no free time | ✗ | ✗ | ✗ | — | ✗ | ✗ | — | ✗ | ✔ | ✔ | ✗ |
| Fora, em atraso gravado | ✔ | ✔ | ✗ | — | **✗** | ✔ | — | **✗** | ✔ | ✔ | ✗ |
| Fora, em atraso real com status defasado | **✗** | **✗** | ✗ | — | ✗ | **✗** | — | ✗ | ✔ | ✔ | ✗ |
| Fora, tipo sem tarifa | **✗** | **✗** | ✗ | — | ✗ | **✗** | — | ✗ | ✔ erro | ✔ erro | ✗ |
| Devolvido no free time, sem Invoice | ✗ (filtro do front) | ✗ | ✗ | — | ✗ | ✗ | — | ✗ | ✔ | ✔ | ✗ |
| Devolvido com sobreestadia, sem Invoice | ✔ "A faturar" | ✗ | ✔ | — | **✗** | ✗ | — | **✗** | ✔ | ✔ | ✗ |
| Idem, B/L sem CE ou gate fechado | ✔ "A faturar" (**recusado**) | ✗ | ✔ | — | ✗ | ✗ | — | ✗ | ✔ | ✔ | ✗ |
| Idem, B/L sem Cliente | ✔ "A faturar" (**recusado**) | ✗ | ✔ | — | ✗ | ✗ | — | ✗ | ✔ | ✗ | ✗ |
| Idem, B/L cancelado | ✔ "A faturar" (**recusado**) | ✗ | ✔ | — | ✗ | ✗ | — | ✗ | ✔ (só leitura na staging) | ✗ | ✗ |
| Devolvido, tipo sem tarifa | ✔ "Nada a cobrar" + erro | ✗ | ✔ | — | ✗ | ✗ | — | ✗ | ✔ erro | ✔ erro | ✗ |
| SOC sem Invoice | ✗ | ✗ | ✗ | — | ✗ | ✗ | — | ✗ | ✔ "Não se aplica (SOC)" | ✔ "SOC" | ✗ |
| SOC já faturado | ✔ | conforme o status | ✔ | ✔ | ✔ se `issued` | ✗ | ✔ | ✔ | ✔ | ✔ "SOC" (esconde a Invoice) | ✔ |
| Caixa em Invoice `issued` | ✔ "cobrada em" | se `overdue` | ✔ | Fat | ✔ | se `overdue` | ✔ | ✔ | ✔ (diz "a faturar") | ✔ Invoice | ✔ com CE |
| Caixa em Invoice `paid` | ✔ "cobrada em…pago" | — | ✔ | Pg | ✗ | — | ✗ | ✔ | ✔ (diz "a faturar") | ✔ | ✔ |
| Caixa só em Invoice cancelada | ✔ "A faturar" de novo | — | ✔ | Can | ✗ | — | ✗ | ✔ (Invoice) | ✔ | ✔ | ✗ |
| Viagem cancelada, fora | ✗ | ✗ | ✗ | — | ✗ | ✗ | — | ✗ | ✔ | **✔ "correndo"** | ✗ |
| Irmão do grupo no free time | ✗ (só conta em "Aguarda devolução de N") | ✗ | ✗ | — | ✗ | ✗ | — | ✗ | ✔ | ✔ | ✗ |

Disputas aparecem na aba Disputas **independentemente** da situação da Invoice e do B/L (`_list_demurrage_disputes_internal_impl_20260920`, `472:612-634`). **SQL** e **Runtime local**.

**Contagens no banco local** (dataset `QV` com 42 containers nestas contagens; o QV-18 entrou depois, 29/10/2026):

| Superfície | Antes do job | Depois do job |
|---|---|---|
| Linhas de `listDemurrageContainers` | 33 | 36 |
| Tiradas pelo filtro do front (devolvido no free time) | 1 (QV-05) | 1 |
| Lente Todos | **32 linhas = 28 caixas** | 35 |
| Lente Em atraso | 4 | 7 |
| Lente Devolvidos | 28 | 28 |
| Cartão Containers em atraso | 4 | 7 |
| Faturas / Pagas / Canceladas | — | 11 / 4 / 2 Invoices |
| Por Cliente | — | **1 Cliente** (QV CLIENTE UM); ficam de fora o Cliente com acordo (US$ 540 correndo), o Cliente só com pagas e o Cliente só com exposição (US$ 1.340) |
| Portal do Cliente 1 | — | 14 Invoices (emitidas e pagas, inclusive a paga do B/L cancelado QV-12A) |
| Disputas | — | 2 (1 aberta, 1 resolvida) |

"Depois do job" significa depois de `refresh_containers_demurrage_status()`, que atualizou 3 linhas. A contagem das abas de Invoice foi feita antes dos passos finais (cancelamento da DEM-2026-0009, fila do QV-04 e QV-18).

### 2.2 Aba Containers: regras de inclusão (A2)

**A2.1 Status.**

- A leitura é `bl_containers` com `discharge_date` não nula e `demurrage_status IN ('overdue','returned')` (`demurrageContainers.ts:290-298`).
- Somam-se os containers que estão em itens de Invoice `issued|overdue|paid`: são lidos pelo `container_id` e também exigem descarga (`:261-267`, `:300-309`).
- `within_free_time` nunca entra, salvo container já faturado.

**Confirmado. Não há off-by-one.**

| Lado | Regra |
|---|---|
| SQL | `overdue` quando `hoje_SP − descarga > free` (`211:185`) |
| Front | `dc = round((fim − descarga)/dia)` e `dc <= freeUntil` → no prazo (`demurrageRates.ts:305-308`) |
| Cobrança no banco | `days_p1 = min(total, p1_to) − free`; `days_p2 = total − max(p2_from, free+1) + 1` (`191:458-462`) |
| Cobrança no front | as mesmas expressões (`demurrageRates.ts:311-316`) |

Os dois lados entram em atraso no dia **descarga + free + 1**. **Runtime local:** descarga D−21 ficou `within_free_time` e D−22 ficou `overdue` (QV-01B).

A tela pode diferir num detalhe só: o front carrega as tarifas pela data **UTC** (`demurrageRates.ts:105`), e o banco usa a data de São Paulo. Entre 21h e 24h de Brasília, uma tarifa que começa ou termina no dia seguinte vale três horas antes na prévia (P3).

**A2.2 Devolvido.**

- O filtro `monitored` (`DemurrageContainersTab.tsx:109-114`) tira o devolvido com cálculo zero, sem erro e sem `billed_in`. O doc diz isso: `demurrage.md:135`.
- Entram: o **devolvido com cobrança zero pelo acordo** (sai, porque o cálculo dá zero), o devolvido já faturado (entra), o devolvido com desconto (entra, porque está faturado) e o devolvido com **erro de cálculo** (entra, com o erro na célula US$ da linha do container).
- **Problema.** O erro só aparece ao abrir a linha do B/L. Na linha fechada, o estado é **"Nada a cobrar"** (`:402`), porque `safeTotalUsd` devolve 0 no erro (`demurragePresentation.ts:163-168`). Cenário 14.
- O estado vazio (`DemurrageContainersTab.tsx:218`) não descreve essas exceções nem os casos de B/L cancelado ou sem Cliente.

**A2.3 SOC.**

- SOC fica fora, salvo se o `container_id` estiver em item de Invoice viva (`:314`). O casamento é por **id**: uma caixa SOC cobrada por meio do irmão (outro id) fica fora.
- A troca SOC↔COC recalcula o status na hora, porque o gatilho cobre `ownership`.
- **Virar SOC depois de faturado** é aceito sem reconciliar nada. A Invoice continua cobrando, e a ficha do Cliente mostra "SOC" em vez da Invoice (`customerContainers.ts:102`). Cenário 6. **Runtime local.**

**A2.4 Já faturado.**

- `billed_in` casa pela **chave** `(Viagem do B/L da Invoice, Cliente da Invoice, número normalizado)` (`demurrageContainers.ts:84-97`). É a mesma chave de `_demurrage_billed_container_keys` (`214:64-83`), com `trim().toUpperCase()` contra `upper(btrim())`. São equivalentes salvo para espaço Unicode.
- **Item sem `container_id` não existe.** A coluna é NOT NULL, e a FK para `bl_containers` não tem `ON DELETE`, então fica `RESTRICT`. Container já faturado, mesmo em Invoice cancelada, não pode ser apagado pela reimportação. **Runtime local:** `pg_constraint`.
- **Invoice cancelada libera a caixa.** `_demurrage_billed_container_keys` só conta `issued`, `overdue` e `paid`. A linha volta a "A faturar", mas **nada reenfileira a emissão**: alguém precisa clicar. Cenário 8c.

**A2.5 B/L e Viagem cancelados, B/L sem Cliente.**

- O filtro de cancelamento **não está** em `listDemurrageContainers`, só no status gravado.
  - Container **fora** de B/L ou Viagem cancelados vira `within_free_time` na hora (gatilho da `200`) e sai.
  - Container **devolvido** continua `returned` e **continua listado**.
  - Sem `billing_group` (o front tira o B/L cancelado em `:112`), o estado cai para "A faturar" com **Gerar Invoice**. O banco recusa: "O B/L QV-12C está cancelado…".
- B/L cancelado com Invoice **paga** fica listado como cobrado, sem nenhuma marca de "B/L cancelado".
- B/L sem Cliente:
  - fora: aparece como "Cliente não vinculado" e Em atraso;
  - devolvido: "A faturar" com botão; o banco recusa ("sem cliente para emissão de Demurrage").

  Cenários 12 e 13. **Runtime local.**
- O doc erra aqui: `demurrage.md:302` diz "B/L ou Viagem Cancelados ficam fora pela `200`".

**A2.6 Grupo.**

- **Irmão no free time.** Não aparece, mas segura a emissão. A linha diz **"Aguarda devolução de N containers"** sem dizer quais.
  - No QV-07A, a tela mostra **"2 de 2 devolvidos"** e, na mesma linha, **"Aguarda devolução de 1 container"**. A caixa que falta (QVCU7700073, do QV-07B) não aparece em nenhum lugar de `/demurrage`.
  - No QV-01B, aparece "0 de 1 devolvidos" com "Aguarda devolução de **2**".
- **Mesmo número em dois B/Ls do mesmo Cliente e Viagem.** Vira duas linhas, uma por B/L, e uma cobrança só.
  - A ação aparece só no primeiro B/L do grupo. O outro diz "Cobrança junto com o B/L X".
  - O resumo conta a caixa uma vez, mas a lente conta **duas**: "Todos (32)" contra "28 containers".
- **Mesmo número em Clientes diferentes.** Cada Cliente recebe a sua Invoice cheia, **US$ 940 + US$ 940** pela mesma caixa física (QV-18A e QV-18B). A chave e o grupo são por Cliente (`191:337-366`; `214:64-83`). As datas, porém, se propagam para todos os B/Ls ativos da Viagem, sem filtro de Cliente (`_lock_container_date_sets`, `211`). **Runtime local.** Ver pergunta 6.
- **Caso `ponytail`** (`demurrageContainers.ts:324-330`). Reproduzido em QV-07C e QV-07D:
  - QV-07D chega com a caixa já cobrada e uma caixa nova no free time.
  - Os dois B/Ls aparecem sem pendência, com só a Invoice, enquanto `issue_demurrage_invoice_for_bl('QV-07D')` devolve `waiting_return`.
  - **Não perde dinheiro.** Quando a caixa nova vence ou volta, ela entra na lista e o grupo é lido. A devolução também enfileira a complementar (`_after_container_dates`, `214:443-484`).
  - **Atrasa a visibilidade.** A tela mostra "tudo cobrado" para um grupo que ainda não fechou.

**A2.7 Filtros silenciosos.**

- **Paginação.** `readAllPages` (`:172-180`) lê todas as páginas, e os ids vão em lotes de 150 (`:182-186`). Não há corte em 1000 nesta aba. O corte existe nas abas de Invoice, KPIs e Por Cliente (P2-7).
- **Ordenação.** Descarga mais recente primeiro (`:313-315`).
- **Busca.**
  - Containers casa número do container, B/L, nome do Cliente e número da Invoice (`DemurrageContainersTab.tsx:61-71`). **Não casa CNPJ nem Navio ou Viagem.**
  - As abas de Invoice casam Invoice, B/L, Cliente e CNPJ, mas **não o container** (`DemurrageInvoicesTab.tsx:42-53`).
- **Filtros sem uso.** `customerId`, `voyageId` e `blId` de `listDemurrageContainers` (`:296, 317-322`) nunca são passados: a única chamada é `Demurrage.tsx:144`, sem argumentos.
- **Grupo pelo número exato.** A busca do irmão do grupo usa `.in('container_number', …)` com o número exato (`:231-236`). O CHECK de formato ISO (`bl_containers_container_number_iso`) é `NOT VALID`, então só linhas antigas podem divergir.

### 2.3 Tabela de ciclo de vida (A11)

A latência da tela soma o `staleTime` de 60 s (Containers, KPIs e Por Cliente) e de 30 s (Invoices e Disputas) às invalidações de `cacheEffects.ts`. Em outra aba do navegador, a tela só muda ao recarregar ou quando o React Query relê a consulta.

| # | Evento | Condição | Quem grava | Latência | Passa a aparecer em | Some de | Onde NÃO aparece (e deveria?) | Evidência |
|---|---|---|---|---|---|---|---|---|
| 1 | Container criado (importação do B/L) | sem descarga | INSERT; gatilho grava `within_free_time` | imediata | FB e FC ("Sem descarga") | — | Central: correto, sem descarga não corre. A ATA não preenche a descarga (`propagate_voyage_ata_to_containers` existe sem gatilho) | **SQL** `197`; **Runtime local** |
| 2 | Descarga gravada (planilha ou **Editar datas**) | data antiga ou recente | `apply_container_dates_batch_atomic` (`499`) → `_apply_container_dates_core`; `set_container_dates` (`211`/`504`); o gatilho recalcula o status | imediata; a tela invalida por `afterDatasContainerAlteradas` | Containers T/A, KPI e cabeçalho se já vencido; FB e FC sempre | — | — | **SQL**; `ContainerDatesImportModal.tsx:82-83` |
| 3 | Free time vence sem ninguém mexer | dia descarga+free+1 em São Paulo | job `container-demurrage-status` `17 3 * * *` UTC = **00:17 BRT** | 0 a 17 min depois da meia-noite, mais o `staleTime` | T, A, KPI-a, cabeçalho | — | Por Cliente e Relatório: **sim, deveria** (exposição) | **Runtime local** (`cron.job`) |
| 4 | Free time do B/L, acordo, tarifa ou Cliente do B/L mudam | o container já passou do prazo novo | **ninguém** recalcula o status; só o job | **até ~24 h** | FB e FC na hora (cálculo do front) | — | **Central, KPI e cabeçalho até o job: deveria** | **Runtime local**, cenários 3, 14 e 15; nenhum gatilho em `bls`, `customer_demurrage_agreements` ou `demurrage_rates` recalcula status |
| 5 | Devolução gravada | — | gatilho → `returned`; `_after_container_dates` enfileira `demurrage_billing` quando o grupo todo voltou com caixa sem Invoice | imediata; a Invoice sai quando o `import-effects-runner` roda (segundos) | D; "A faturar" até a emissão | A; T, se devolveu no free time | Se é o irmão de um grupo que ainda espera: "Aguarda devolução de N" sem nome | **SQL** `214:443-484`; **Runtime local** QV-04 |
| 6 | Emissão (fila ou **Gerar Invoice**) | Cliente, CE, gate, B/L e Viagem ativos, tarifa, sobreestadia > 0 | `issue_demurrage_invoice_for_bl` (`472:129`) → `create_demurrage_invoice_authoritative` (`472:232`) | imediata; `afterFaturaDemurrageAlterada` | Fat, PC, KPI-p, Rel, Portal (com CE), FB do **âncora**, FC; Containers "cobrada em X" | "A faturar" | FB do B/L não âncora: "nenhuma fatura" e "a faturar". **Deveria** listar a Invoice do grupo | **Runtime local** QV-09B e QV-07D |
| 6b | Emissão bloqueada | sem CE ou gate fechado | a RPC devolve `blocked`; o efeito termina **`succeeded`** | — | nada novo | — | **Containers segue "A faturar" com um botão que falha; sem Alerta.** Deveria dizer o motivo | **Runtime local** QV-04B (efeito 2) |
| 7 | Irmão chega com caixa nova (complementar pendente) | o grupo já tem Invoice | gravação de datas → efeito; ou **Gerar complementar** | segundos ou à mão | Containers "N caixas sem Invoice" no âncora | — | — | **Runtime local** QV-09A e QV-09B |
| 8 | Complementar emitida | — | mesma RPC (`complementary: true`) | imediata | Fat como **linha própria** no âncora; "Complementar" só por inferência (`earlierLiveInvoices`) | — | Ligação com a original não fica gravada | **Runtime local** DEM-2026-0017; `demurragePresentation.ts:237-257` |
| 9 | Desconto | Invoice emitida | `apply_demurrage_discount` (`357`) | imediata | Fat "USD a cobrar" líquido; BRL e QR novos; 100% → Pg | — | Rel e exportações mostram o USD **bruto** | **Runtime local** QV-10A |
| 10 | Datas mudam depois da emissão, sem pagamento, desconto ou disputa | — | `_reconcile_demurrage_after_dates` (`484:124`): cancela e reemite (`replaces_invoice_id`) | na mesma transação | Fat (nova), Can (antiga) | — | — | **Runtime local** QV-08A (DEM-0003 → DEM-0015) |
| 11 | Datas mudam com pagamento, desconto ou disputa | — | o mesmo; `dunning_suspended_reason` + Alerta `demurrage_invoice_dates_changed` (Administrativo) | imediata | Régua "Pausada…" em Fat; "Fora da Régua" em Pg; aviso no detalhe; Alertas | — | **Containers, Por Cliente, Relatório e Portal não mostram a suspensão.** Containers mostra o US$ recalculado (1.100) ao lado da Invoice (940) | **Runtime local** QV-10A e QV-10B |
| 12 | Disputa aberta no Portal | Invoice `issued/overdue/paid` com CE | `portal_add_dispute_message` (`473:134`) | imediata | Disputas; "Em disputa" em Fat; Régua pausada; Alerta para Equipamentos; cartão Disputas | — | — | **Runtime local** DEM-0009 |
| 13 | Disputa respondida ou resolvida | — | `add_demurrage_dispute_message` (próximo = Cliente ou Ninguém) | imediata | Disputas › Resolvidas; Portal › Encerradas | Abertas | — | **Runtime local** DEM-0010 |
| 14 | Disputa reaberta | resolvida | `reopen_demurrage_dispute` (`426`) | imediata | Abertas | Resolvidas | Não confere a situação da Invoice: reabre até em Invoice cancelada (**Código** `426`, segundo a revisão auxiliar) | **SQL** |
| 15 | Pagamento (Itaú, extrato ou manual) | `issued` | `register_demurrage_payment` (`027`/`509`) | imediata | Pg, Rel (R$ congelado), Portal "Paga"; Containers "pago" | Fat, PC, KPI-p | **FB continua "a faturar"** | **Runtime local** QV-08B |
| 16 | Cancelar baixa | Administrativo | `reverse_demurrage_payment` (`446`) | imediata | Fat de novo; Pix volta a análise | Pg | Histórico da Conciliação: some sem rastro (`reconciliacao.ts:595` lê só `paid`) | **Código** |
| 17 | Restituição | Invoice paga | `request_financial_refund` / `confirm_demurrage_refund` | imediata | detalhe (painel), recibo, Alerta `restituicao_pendente` | — | Rel "Recebido (R$)" não desconta a restituição | **Código** `reports.ts:723-725` |
| 18 | Cancelar Invoice | Administrativo, `issued` | `cancel_demurrage_invoice` (`012`/`509`) | imediata | Can; a caixa volta a "A faturar" | Fat, PC, KPI-p, Portal | **Disputa aberta fica presa**; nada reenfileira a emissão | **Runtime local** DEM-0005 e DEM-0009 |
| 19 | Cancelar B/L | com Invoice `issued` | `cancel_bl` recusa ("fatura de Demurrage em aberto") | — | — | — | — | **Runtime local** QV-12A2 |
| 19b | Cancelar B/L | com Invoice paga, ou devolvido sem Invoice | `cancel_bl` aceita; o gatilho `200` refaz o status dos que não voltaram | imediata | Pg e Portal mantêm a paga | containers fora | **Devolvido sem Invoice segue "A faturar" impossível; cobrança perdida** | **Runtime local** QV-12A e QV-12C |
| 20 | Cancelar Viagem | fora em atraso | `cancel_voyage` → gatilho `200` → `within_free_time` | imediata | — | T, A, KPI-a | **FC continua "correndo US$ 1.340"** (filtra só o B/L cancelado) | **Runtime local** QV-12B; `customerContainers.ts:43-50` |
| 21 | Reativar B/L ou Viagem | — | o mesmo gatilho (`200`) | imediata | volta conforme o status | — | — | **SQL** |
| 22 | Container removido na reimportação | caixa já faturada | FK `RESTRICT` impede apagar | — | — | — | — | **Runtime local** (`pg_constraint`) |

**Pergunta direta:** um container pode passar um dia inteiro em atraso real sem aparecer em `/demurrage`?

**Sim**, quando o atraso nasce de uma mudança de free time, acordo, tarifa ou Cliente do B/L (evento 4). A janela vai do momento da mudança até as 00:17 do dia seguinte, ou seja, até cerca de 24 h. No vencimento natural, a janela é de 0 a 17 min depois da meia-noite. No tipo sem tarifa, a janela **não tem fim** enquanto o container estiver fora.

### 2.4 Abas de Invoice, Por Cliente, Disputas, Relatórios, Portal e ficha do B/L (A5–A10)

**A5. Abas de Invoice.**

- Faturas = `status='issued'`, Pagas = `'paid'`, Canceladas = `'cancelled'`, cada uma com o status exato (`demurrageInvoiceTabs.ts:5-13`; `demurrageInvoices.ts:161-176`).
- **`draft` e `overdue` ainda são aceitos** pelo CHECK `demurrage_invoices_status_check`, e o padrão da coluna é `'draft'`.
  - Nenhuma função grava esses valores: busquei UPDATE e INSERT com `'overdue'` ou `'draft'` em `demurrage_invoices` e só achei a leitura de `capture_demurrage_calculation_snapshot`.
  - `authenticated` não tem INSERT na tabela.
  - Se aparecesse uma Invoice nesses estados, ela ficaria **sem aba** e fora dos totais de Faturas, mas **visível no Portal**, que trata `overdue` como em aberto.
- A complementar é linha própria.
- `paid_at` com `issued` não tem caminho: `reverse_demurrage_payment` e `reopen_demurrage_invoice` limpam `paid_at`.
- Invoice cancelada com `paid_at` (restituição integral) cai em Canceladas, com "Ver recibo".
- A busca não casa o número do container.
- **Não há paginação:** acima de 1000 Invoices num status, a aba corta em silêncio (`supabase/config.toml:85`, `max_rows = 1000`).

**A6. Por Cliente.**

- Só Clientes com Invoice `issued` e `paid_at` nulo (`demurrageKpis.ts:40-72`). Hipótese **confirmada**:
  - exposição não faturada: **não** aparece;
  - Cliente só com disputa aberta: aparece, porque a Invoice continua `issued`;
  - Cliente só com pagas: **não** aparece.
- `CustomerSummaryReport` usa a mesma consulta (`Demurrage.tsx:628`).
- USD líquido do desconto (`invoiceNetUsd`) e BRL de `current_total_brl`, que o banco já grava líquido (`apply_demurrage_discount`; DEM-0007: US$ 846 × ROE = R$ 5.045,54). **Coerente.**

**A7. Disputas.**

- Os estados possíveis são só `aberta`, `resolvida` e `cancelada`. "Respondida" e "reaberta" não existem como estado; a vez de quem responde fica em `next_responder`.
- **Na prática, `cancelada` é inalcançável:** nenhuma função grava `dispute_status='cancelado'`.
- Disputa de Invoice cancelada ou paga continua visível. A de Invoice cancelada fica **presa** (cenário 11).
- A contagem respeita a permissão em parte:
  - o cartão Disputas aguardando resposta aparece só para Equipamentos e Administrativo (`Demurrage.tsx:446-454`);
  - o número na aba aparece para todos (`:464-473`), como "aguardando resposta" de Equipamentos.

**A8. Relatório.**

- Outro universo: **só Invoices** (`reports.ts:685-729`). Hipótese **confirmada.**
- "Vencidas" usa `due_date < hoje` (`reports.ts:709`), mas a emissão nunca grava `due_date`: o INSERT em `472:352-359` não tem a coluna.
  - **Runtime local:** 17 de 17 Invoices sem `due_date`. O filtro **sempre devolve zero**.
  - É um conceito diferente da lente Em atraso, que trata de container.
- O filtro de data usa `doc_date` (`DEFAULT CURRENT_DATE`, data do servidor em UTC), a lista ordena por `created_at`, e `/demurrage` mostra `billed_at` (dia de São Paulo).
  - **Suspeita:** a Invoice emitida entre 21h e 24h de Brasília cai no dia seguinte no relatório.
- Com Navio / Viagem, o B/L entra como `!inner`. Nenhuma Invoice fica sem B/L, porque `bl_id` é NOT NULL com FK.

**A9. Portal.**

- O Cliente vê Invoices `issued`, `overdue` e `paid` do próprio Cliente, com CE no B/L (`_portal_list_demurrage_invoices_core`, `002:437-460`; `bl_has_portal_release` só confere o CE).
  - **Runtime local:** o Cliente 1 viu 14 Invoices, incluindo a **paga do B/L cancelado**.
- Ops vê e o Cliente nunca vê:
  - containers em atraso;
  - "A faturar";
  - complementar pendente;
  - Invoices canceladas;
  - Régua e suspensão;
  - histórico de recálculo;
  - justificativa do desconto;
  - notas da disputa;
  - motivo do cancelamento.
- O Cliente vê e Ops não vê: a Invoice `overdue`, se voltasse a existir, porque as abas internas não têm `overdue`.
- O Cliente vê Disputa resolvida em "Encerradas".
- A ADR 0088 trata de **Taxas Locais**. Para Demurrage, a regra vigente é a de `demurrage.md:405-417`.

**A10. Ficha do B/L × central.**

- **População diferente.**
  - A ficha mostra todas as caixas do B/L: no free time, SOC e sem descarga (`BlDemurrageSection.tsx:255-282`).
  - A central mostra só `overdue`/`returned`, ou caixa já faturada.
- **Mesmo cálculo e mesma precedência** (`calculateDemurrage`; B/L > acordo vigente na descarga > tabela).
- **Ponto de divergência:** a ficha lê o acordo pelo hook e calcula na hora, sem depender do status gravado. Por isso a ficha mostra "em curso" para QV-03, QV-14 e QV-15 enquanto a central não os lista.
- A ficha ignora a cobrança por caixa:
  - diz **"a faturar"** em caixa já paga (QV-08B);
  - diz **"nenhuma fatura de Demurrage"** no B/L não âncora, porque lê `listDemurrageInvoices({ blId })` só do próprio B/L (`BlDetalhe.tsx:152-156`).
- **Links.** `demurrageInvoiceHref` abre `/demurrage?fatura=<id>` e troca para a aba da situação (`Demurrage.tsx:178-193`), o que está certo. Já o link da ficha do Cliente usa `?tab=faturas&fatura=` (`ConteineresTab.tsx:210`): com `tab` presente a aba não troca, e a Invoice paga abre sobre Faturas.

### 2.5 Cenários sintéticos (A12)

**Runtime local**, 29/10/2026. Hoje (São Paulo) = 2026-10-29. A tarifa 40HC tem free time de 21 dias, P1 nos dias 22–30 a US$ 60 e P2 a partir do dia 31 a US$ 80. O ROE da emissão é 5,7510.

| # | Caso (dataset) | Containers | Invoice | PC / KPI | Rel | FB | FC | Portal | Esperado pelo doc | Diverge? |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Fora no free time (QV-01, D−10) | não aparece | — | não | não | "Sem cobrança", free time 21 | none | não | não aparece | não |
| 1b | Borda (QV-01B, D−21 e D−22) | D−22 em Em atraso (US$ 60); D−21 fora; linha "0 de 1 devolvidos · Aguarda devolução de **2**" | — | KPI conta 1 | não | as duas linhas | as duas | não | atraso no dia descarga+22 | rótulo "x de y" |
| 2 | Fora em atraso, sem Invoice (QV-02, D−40) | T e A; "Aguarda devolução de 1"; US$ 1.340 correndo | — | **PC não**; KPI sim | **não** | "em curso" | running 1.340 | não | aparece em Containers | PC e Rel não mostram |
| 3 | Atraso real com status defasado (QV-03 free time do B/L 30→7, D−15; QV-14; QV-15) | **não aparece** até o job; depois entra (Em atraso 4→7) | — | KPI não | não | "em curso" 480 / 1.340 / 540 | running | não | doc não fala | **sim** |
| 4 | Devolvido com cobrança, sem Invoice (QV-04; QV-04B sem CE) | "A faturar" + **Gerar Invoice** nos dois | QV-04: DEM-0018 pela fila; QV-04B: `blocked`, efeito `succeeded` | não | não | "a faturar" | to_bill | não | "Aguarda devolução" ou "A faturar" | QV-04B: tela promete, banco recusa, sem Alerta |
| 5 | Devolvido no free time (QV-05) | excluído pelo front | `no_overstay` | não | não | "Sem cobrança" | none | não | excluído no front | não |
| 6 | SOC em atraso (QV-06A); SOC já faturado (QV-06B) | 06A não; 06B "cobrada em DEM-0001" | 06B segue `issued` | 06B conta | 06B | "Não se aplica (SOC)" | "soc" nos dois | 06B sim | SOC fora, salvo já faturado | FC esconde a Invoice do 06B |
| 7 | Grupo QV-07A/07B (uma caixa no free time); QV-07C/07D (irmão já cobrado e caixa nova no free time) | 07A "**2 de 2 devolvidos** · Aguarda devolução de 1"; 07B "Cobrança junto com o B/L QV-07A"; 07C/07D só com Invoice | RPC: `waiting_return` nos dois grupos | — | — | 07D: "a faturar" e "nenhuma fatura" | to_bill / invoice | — | `ponytail` documentado | caixa que falta invisível; FB mente |
| 8 | `issued` (QV-08A), paga (QV-08B), cancelada (QV-08C) | 08C volta a "A faturar" | Fat / Pg / Can | PC e KPI só 08A | as três | 08B: "a faturar" | invoice | 08A e 08B | caixa volta ao cancelar | FB "a faturar" em paga |
| 9 | Complementar pendente (QV-09A/09B) e emitida (QV-09C/09D) | 09A "1 caixa sem Invoice · Gerar complementar" | DEM-0017 `complementary: true` no âncora 09C | conta | sim | 09B "a faturar", sem Invoice | to_bill 1.100 | sim | como o doc | FB do não âncora |
| 10 | Datas mudam depois da emissão: com desconto (QV-10A), paga (QV-10B), sem nada (QV-08A) | 10A/10B "cobrada", **sem sinal de suspensão**, US$ 1.100 contra 940 da Invoice | 10A/10B `dunning_suspended_reason` + Alerta; 08A reemitida DEM-0015 (substitui 0003) | 10A segue em PC e KPI | sim | — | — | sim | como o doc | Containers não mostra a suspensão |
| 11 | Disputa aberta (DEM-0009) e resolvida (DEM-0010) | — | "Em disputa" | KPI Disputas 1 | sem coluna de disputa | — | — | Encerradas | como o doc | depois de cancelar a DEM-0009: **Disputa presa** |
| 12 | B/L cancelado com Invoice viva (12A2 `issued`: recusado; 12A paga: aceito); sem Invoice (12C); Viagem cancelada (12B) | 12A "cobrada…pago", sem marca de cancelado; **12C "A faturar" + botão**; 12B some | 12A em Pg e Portal | — | 12A | 12C só leitura (staging) | 12A/12C omitidos; **12B "running 1.340"** | 12A paga visível | "B/L ou Viagem cancelados ficam fora" | **doc errado; FC errada** |
| 13 | B/L sem Cliente (13A fora; 13B devolvido); B/L sem Viagem impossível | 13A "Cliente não vinculado", Em atraso; 13B "A faturar" + botão → recusado | — | não | não | ok | não entra | não | — | botão recusado |
| 14 | Tipo sem tarifa (22T6) | 14 (fora) **nunca**; 14B (devolvido) "**Nada a cobrar**" + erro na linha do container | RPC: "Dados insuficientes ou tarifa inválida" | não | não | erro "sem tarifa" | erro | não | doc não fala | **sim** |
| 15 | Acordo de 40 dias contra tarifa de 21 (QV-15, D−30) | não aparece (correto); com o acordo desativado, só depois do job | — | não | não | 21 → overdue 540 | running 540 | não | escolha pela descarga | latência do status |
| 16 | PTAX recalculada × paga (QV-16A, QV-16B) | — | 16A: R$ 5.405,94 → R$ 5.606,16 (ROE 5,9640); 16B fica R$ 5.405,94 | KPI-p segue | "Faturado (R$)" mistura as duas | — | — | 16A atualizado | congela no pagamento | Rel mistura as duas |
| 17 | Mesma caixa, Clientes diferentes (QV-18A/18B) | duas linhas | **duas Invoices de US$ 940** | — | — | — | — | — | grupo é por Cliente | ver pergunta 6 |

### 2.6 Correções a `docs/modules/demurrage.md`

As linhas abaixo valem para as duas branches, porque até a l.733 o arquivo é igual.

1. **l.302** diz "B/L ou Viagem Cancelados ficam fora pela `200`". Corrigir para: **só o container que não voltou** sai; o devolvido de B/L cancelado continua listado (e hoje aparece como "A faturar").
2. **l.307** diz que salvar o free time e o P1/P2 do B/L "invalida `queryKeys.bls.detail`, `queryKeys.bls.all()` e `['demurrage-containers']`". O código invalida **só** o detalhe do B/L (`BlDemurrageSection.tsx:150`). E o status gravado não muda até o job.
3. **l.463-484** ("Datas do container e status") precisa dizer duas coisas:
   - mudança de free time do B/L, acordo, tarifa ou Cliente do B/L **não recalcula o status**: só o job das 00:17 de Brasília faz isso;
   - tipo sem tarifa nunca fica `overdue` (`ponytail:` da `197`).
4. **l.132-136.** Acrescentar: o filtro do front **mantém** o devolvido de B/L cancelado, o de B/L sem Cliente e o com erro de cálculo. Quando o erro é "sem tarifa", a linha do B/L diz "Nada a cobrar".
5. **l.150.** Esclarecer que, em "x de y devolvidos", o `y` conta **as caixas listadas e visíveis no recorte**, não as do B/L. "Aguarda devolução de N" conta caixas que a aba não mostra.
6. **l.168-172** (`ponytail`). Registrar que a linha diz "tudo cobrado" enquanto a RPC devolve `waiting_return`.
7. **l.636-648** (trava de emissão). "Pela fila de efeitos, a emissão fica `blocked`" está impreciso: o efeito termina **`succeeded`**, com `result.status = 'blocked'`, sem Alerta. A aba Containers segue "A faturar".
8. **l.303** ("três consultas") inclui a consulta de `draft`, que não é exibida (`demurrageKpis.ts:128, 136`).
9. **l.1018+** (Disputa; na `staging` +9 linhas). Registrar que cancelar a Invoice não fecha a Disputa.

Fora deste módulo:

- `docs/modules/portal-cliente.md:935` diz que o CE "não define elegibilidade de cálculo/emissão no sistema interno", o que está desatualizado desde a `472`.
- `docs/modules/portal-cliente.md:937` cita o prefixo `[Portal]`, que `portal_add_dispute_message` (`473`) não grava.
- `docs/modules/operacao-suporte.md:147, 158` descreve o filtro "Vencidas" e a coluna "Vencimento" como se funcionassem.

---

## 3. Achados por severidade

Formato: **o que**, evidência, reprodução, impacto, hipótese do mapeamento, `main`/`staging`.

### P1

**P1-1. Tipo de container sem tarifa: atraso invisível na central e "Nada a cobrar" quando volta.**

- **Evidência:**
  - `_container_demurrage_status` só grava `overdue` com `_container_free_days` não nulo (`211:180-187`). O `ponytail:` original está em `197`.
  - `DemurrageContainersTab.tsx:399-402`; `demurragePresentation.ts:155-168` (erro vale 0).
  - `_calculate_demurrage_invoice_authoritative` recusa (`191:466-484, 522`).
- **Reprodução:** cenário 14 (22T6).
- **Impacto:** o container corre sem entrar no cartão, no cabeçalho nem na lista. Quando volta, a linha do B/L diz que não há nada a cobrar. A dependência é real: a tabela de aliases não cobre `22U1`, `42U1`, `22P1` nem `22T*` (`demurrageRates.ts:29-36`). **Suspeita:** quais tipos existem em produção não foi verificado.
- **Hipótese:** nova.
- **`main` e `staging`:** iguais.

**P1-2. Exposição não faturada fora de Por Cliente, KPIs e Relatórios; nenhum relatório de exposição.**

- **Evidência:** `demurrageKpis.ts:40-72, 125-139`; `reports.ts:685-729`; `exports.ts:302-320`. A busca por exportação de containers em atraso só achou a ficha do Cliente (`exports.ts:564-593`).
- **Reprodução:** seção 2.1. QV CLIENTE DOIS (US$ 540 correndo) e QV CLIENTE QUATRO (US$ 1.340) não aparecem em Por Cliente.
- **Impacto:** quem pergunta "quanto temos a cobrar" só acha o que já virou Invoice. O valor previsto existe só na faixa da aba Containers, sem exportação e sem quebra por Cliente.
- **Hipótese:** **confirmada.**
- **`main` e `staging`:** iguais.

**P1-3. "A faturar" e "Gerar Invoice" para o que o banco recusa.**

- **Evidência:**
  - `blBillingState` decide sem saber de B/L cancelado, Cliente, CE ou gate (`demurragePresentation.ts:146-161`).
  - `buildBillingGroups` descarta o B/L cancelado e o B/L sem Cliente (`demurrageContainers.ts:112`), então o estado cai nas caixas listadas.
  - A emissão recusa: `472:152-162` (cancelado e sem Cliente) e `472:219-222` (bloqueio).
  - O efeito termina `succeeded` com `blocked` (`process_import_effect`, `394`; `_run_import_effect_demurrage`, `294`).
- **Reprodução:** QV-04B, QV-12C e QV-13B.
- **Impacto:**
  - "a faturar (previsto)" fica inflado: US$ 6.740, dos quais US$ 2.820 não podem ser emitidos;
  - o botão falha com a mensagem do banco;
  - o B/L sem CE fica parado sem Alerta.
- **Hipótese:** nova.
- **`main` e `staging`:** iguais.

**P1-4. Ficha do B/L diz "a faturar" para caixa já cobrada ou paga, e "nenhuma fatura" no B/L não âncora.**

- **Evidência:** `BlDemurrageSection.tsx:283-300, 371-374`, que usa só `calc.status` e a data de devolução; `BlDetalhe.tsx:152-156` (`listDemurrageInvoices({ blId })`).
- **Reprodução:** QV-08B (paga), QV-07D e QV-09B.
- **Impacto:** o operador é levado a cobrar o que já foi cobrado e não acha a Invoice a partir do B/L irmão.
- **Hipótese:** **confirmada.** A ficha mostra outra população e outra conta.
- **`main` e `staging`:** iguais.

**P1-5. B/L cancelado com sobreestadia sem Invoice: perda sem aviso.**

- **Evidência:** `cancel_bl` aceita (`bl_open_financial_reasons` só olha Invoice em `draft/issued/overdue`, migration `362`, segundo a revisão auxiliar). O cancelamento foi **Runtime local**: `{"reasons": [], "cancelled": true}`. Depois, `issue_demurrage_invoice_for_bl` recusa.
- **Reprodução:** QV-12C.
- **Impacto:** a cobrança de uma caixa que ficou fora 35 dias some. A central continua dizendo "A faturar". A regra não está decidida (pergunta 4).
- **Hipótese:** **confirmada.** O filtro de cancelado depende do banco e não pega o devolvido.
- **`main`/`staging`:** igual. Na `main`, "Editar datas" do 12C termina sem erro sem gravar nada no B/L; a `504` corrige isso.

**P1-6. Disputa presa depois de cancelar a Invoice.**

- **Evidência:** `cancel_demurrage_invoice` não fecha a Disputa; `portal_add_dispute_message` exige status `issued/overdue/paid` (`473:150-154`); `add_demurrage_dispute_message` exige que a vez seja de Equipamentos.
- **Reprodução:**
  1. Cancelar a DEM-0009 com a Disputa aberta. Resultado: Disputa `aberta`; Cliente recebe P0002 "Fatura de demurrage não encontrada".
  2. A equipe responde uma vez: a vez passa ao Cliente.
  3. Na segunda resposta, a equipe recebe "A Dispute aguarda manifestação do cliente".
- **Impacto:** conversa sem saída e contagem de "aguardando resposta" errada. A tela oferece **Enviar resposta** mesmo quando a vez é do Cliente (`DemurrageDisputeConversation.tsx:276`).
- **Hipótese:** nova.
- **`main` e `staging`:** iguais.

### P2

- **P2-1. Status defasado de até ~24 h** depois de mudar o free time do B/L, o acordo, a tarifa ou o Cliente do B/L.
  - **Evidência:** gatilhos em `bls` (só `trg_bls_cancel_refreshes_demurrage_status`, `trg_enqueue_demurrage_after_ce` e `trg_enqueue_demurrage_after_customer_change`); nenhum em `customer_demurrage_agreements` nem em `demurrage_rates` recalcula status.
  - **Reprodução:** cenários 3, 14 e 15.
  - **Efeito inverso:** quem ganha free time fica em Em atraso com US$ 0 até o job.
- **P2-2. "x de y devolvidos" e "Aguarda devolução de N" contam bases diferentes, e a caixa que falta não aparece.**
  - **Evidência:** `DemurrageContainersTab.tsx:264-265, 289` (caixas visíveis no recorte); `:397` (`stillOut` do grupo inteiro, `demurrageContainers.ts:145-150`).
  - **Reprodução:** QV-07A e QV-01B.
- **P2-3. Containers não mostra a Invoice suspensa por datas alteradas.** Mostra o US$ recalculado (1.100) ao lado da Invoice (940) só com o título "Recalculado hoje…" (`:558`). Cenário 10.
- **P2-4. Ficha do Cliente mostra "correndo" para container de Viagem cancelada.**
  - **Evidência:** `customerContainers.ts:43-50`, que filtra só `bl.cancelled_at`; `customerContainerView` calcula no front.
  - **Reprodução:** QV-12B, "running 1.340".
- **P2-5. Relatório de Demurrage com filtros e números enganosos:**
  - "Vencidas" sempre vazio (`reports.ts:709`; Runtime local);
  - opção "Rascunho" (`Relatorios.tsx:725`; `relatoriosListState.ts:148`);
  - "Total US$" bruto (`reports.ts:715-719`) contra "USD a cobrar" líquido na `/demurrage`. A diferença no dataset é de US$ 94;
  - "Faturado (R$)" soma o BRL flutuante e o congelado (`:720-722`);
  - "Recebido (R$)" não desconta restituição;
  - o cartão "Faturas" conta canceladas e o USD não;
  - a data é `doc_date` (UTC), e não `billed_at`.
- **P2-6. Exportações sem o que a operação usa.**
  - O relatório interno não traz: container, dias, free time e origem, P1/P2, Régua, disputa, ROE e PTAX, valor congelado, desconto, "substitui" ou complementar (`exports.ts:302-320`).
  - A planilha do Portal exporta o USD bruto e o status em código cru (`exports.ts:450-468`). A tela do Portal mostra o líquido (`PortalBillingTabs.tsx:237`).
- **P2-7. Corte silencioso em 1000 linhas** nas abas de Invoice (`demurrageInvoices.ts:161-176`), no cartão Aguardando pagamento (`demurrageKpis.ts:129`) e em Por Cliente (`:41-46`), que não paginam. Não tem efeito no volume atual, mas o Portal pagina e mostraria mais que o Vela.
- **P2-8. Mesma caixa cobrada de dois Clientes.** Runtime local, QV-18. É uma decisão pendente (pergunta 6).
- **P2-9. Lente e resumo contam diferente.** "Todos (32)" conta linhas, e o resumo mostra "28 containers" (caixas). O cartão Containers em atraso e o aviso do cabeçalho contam **linhas**, ou seja, a caixa compartilhada conta duas vezes.

### P3

- **KPI de `draft`.** É consultado e nunca mostrado (`demurrageKpis.ts:93, 128, 136`): consulta morta. Hipótese **confirmada como código morto.**
- **Rótulos de `overdue`.** O mapa `statusLabels.ts:34-40` diz "Vencido" e o selo (`DemurrageBadges.tsx:31`) diz "Em aberto". Os rótulos do selo são masculinos ("Faturado/Pago/Cancelado"), e as abas dizem "Faturas/Pagas/Canceladas".
- **Marca "Complementar".** É inferida (`earlierLiveInvoices`). **Suspeita** da revisão auxiliar: depois de reemitir a original, a marca pode passar para a Invoice errada. Não reproduzi.
- **`?fatura=` com `?tab=`.** Não troca de aba (`Demurrage.tsx:182`). A ficha do Cliente usa esse formato (`ConteineresTab.tsx:210`). Um id inexistente mostra o erro cru do PostgREST (Suspeita).
- **"Abrir conversa da Disputa"** só aparece para quem responde (`DemurrageInvoiceDetailModal.tsx:336-340`), embora todos leiam a aba. O `focusInvoiceId` nunca é limpo.
- **Histórico da Conciliação.** Lê só `status='paid'` (`reconciliacao.ts:595`): a baixa cancelada some sem rastro.
- **Alertas.**
  - `demurrage_invoice_dates_changed` abre a Invoice **cancelada**, mas a ação está em Containers (`alerts.ts:504-506`).
  - `demurrage_ptax_recalc_failed` abre `/demurrage` na aba Containers (`alerts.ts:366`).
- **Notificações do Portal.**
  - "Nova fatura de demurrage" e "disputa respondida" levam a `/portal/billing` sem `?tab=demurrage`, e caem em Taxas Locais.
  - O filtro "Cancelada" do Portal nunca traz linha.
  - Fonte: revisão auxiliar; `notify_demurrage_issued`, `313:395-413`.
- **Tarifas pela data UTC** no front (`demurrageRates.ts:105`).
- **Erro silencioso no cabeçalho.** `useOperationalAlerts.ts:16` devolve 0 quando a consulta falha.
- **Cache incompleto.**
  - `afterReferenciaDemurrageAlterada` não invalida KPIs nem o cabeçalho (`cacheEffects.ts:279-282`).
  - Salvar a condição do B/L não invalida `demurrage-containers`.
  - A restituição usa `afterBlInvoiceBasisAlterada`, que não invalida Por Cliente nem o Portal.
- **Importar datas.** Diz só "N containers atualizados". Não informa os inalterados, as Invoices reemitidas ou suspensas, nem quantos containers entraram ou saíram da lista (`ContainerDatesImportModal.tsx:82-83`).

---

## 4. Problemas de IA e UX nas abas de `/demurrage`

**B1. A pergunta que cada aba responde:**

| Aba | Pergunta de trabalho | Responde? |
|---|---|---|
| Containers | "O que preciso cobrar ou acompanhar hoje?" | **Em parte.** Mistura monitoramento (fora), pendência de emissão (A faturar), caixas já cobradas e B/L cancelado; não separa "o que eu emito agora" de "o que espera" e de "o que está travado e por quê". |
| Faturas | "O que preciso receber?" | Sim, mas inclui as em disputa e as suspensas sem filtro próprio, e não pagina. |
| Pagas / Canceladas | "O que já recebi ou anulei?" | Sim, com o rótulo de coluna "USD a cobrar" mesmo em Pagas e Canceladas (`DemurrageInvoicesTab.tsx:199`). |
| Por Cliente | "Quanto cada Cliente me deve?" | **Não.** Só a parte já faturada (P1-2). |
| Disputas | "O que espera a nossa resposta?" | Sim, mas não diz a situação da Invoice (P1-6). |

Recomendação de IA, sem plano: uma aba de **pendências de cobrança** com três grupos.

- **Emitir agora:** grupo completo, emissível.
- **Esperando:** caixa fora, com o nome da caixa e o B/L dela.
- **Travado:** sem CE, gate, sem Cliente, B/L cancelado, sem tarifa, com o motivo e o atalho.

Containers fica como monitoramento, e Por Cliente ganha a coluna de exposição não faturada.

**B2. Cartões do topo:**

- **Containers em atraso.** `count(bl_containers where demurrage_status='overdue')` (`demurrageKpis.ts:127`). É igual à lente Em atraso **sem busca**, porque as duas contam linhas: a hipótese do mapeamento de que "não bate com a lente" foi **derrubada**. Mas o cartão diverge do resumo, que conta caixas, e herda a latência do status (P2-1). O clique leva à lente Em atraso.
- **Aguardando pagamento (BRL hoje).** Soma `current_total_brl` de `issued`, sem paginação (`:129`), e inclui Invoices em disputa, suspensas e com ROE manual. O clique leva a Faturas. Bate com Faturas e com Por Cliente (R$ 63.492,74 no dataset).
- **Disputas aguardando resposta.** Aparece só para Equipamentos e Administrativo e conta a Disputa presa.
- O dado defasado vem do job das 00:17 e do recálculo das 14h dos dias úteis (`0 17 * * 1-5` UTC). O banner de PTAX só considera o dia útil (`demurragePresentation.ts:15-31`).

**B3. URL:**

- `replace` sempre (`Demurrage.tsx:207-209`). O Voltar do navegador sai da página. É o que o doc decidiu.
- `?fatura=` de fora troca de aba pela situação. Com `?tab=` presente, não troca.
- A lente cai ao trocar de aba (`demurrageListState.ts:66`).
- Não há corrida grave: o detalhe abre pelo id, independentemente da lista.

**B4. Busca:**

- Persiste entre Containers e as abas de Invoice, mas significa coisas diferentes (2.2-A2.7): o container some na busca de Faturas.
- Por Cliente e Disputas ignoram o `?busca=` que continua na URL.
- O erro de carga é um só ("Não foi possível carregar…"). Sem permissão e erro não se distinguem (`QueryStateGate`).

**B5. Tabela de Containers:**

- uma linha por B/L, o que está bom;
- "x de y" e "Aguarda devolução de N" contradizem um ao outro (P2-2);
- B/L bloqueado sem dizer por quê (P1-3);
- o B/L cancelado não tem marca.

**B6. Abas de Invoice:**

- A coluna Régua e o âmbar de disputa batem com o detalhe.
- A cancelada fica com a linha cinza.
- A coluna "USD a cobrar" em Pagas e Canceladas e o "BRL no cancelamento" no resumo de Canceladas são rótulos que confundem.

**B7.** Por Cliente: ver P1-2.

**B8. Disputas:**

- Leitura para todos e escrita para Equipamentos e Administrativo (`demurrageFormRules.ts:13`) batem com a matriz da ADR 0085.
- O anexo que falha depois do upload: o arquivo é removido, mas o erro do `remove` é ignorado (`demurrageDisputes.ts:83-99`). A revisão auxiliar indica uma varredura em 1 dia (`alerts-detector`).

**B9. Ações do cabeçalho:**

- **Tarifas e acordos**, **Régua de cobrança**, **Informar PTAX** (só para os perfis aceitos) e **Importar datas** são descobríveis.
- Cancelar Invoice e cancelar baixa pedem motivo.
- Importar datas não diz o efeito na lista (P3).

**B10. Pilha de modais.** Pagamento, desconto, estorno e dados da disputa voltam ao detalhe **relido** (`refreshDetailAndBack`, `Demurrage.tsx:234-237`). O documento volta sem reler, o que é aceitável porque não grava nada.

**B11.** `ShowInactiveToggle` não existe em `/demurrage`: só em `/demurrage/taxas` (tarifas e acordos).

**B12. Situação na tela.** Fica em texto e é inequívoca nas abas, com uma exceção: Invoice paga com disputa mostra "Pago" sem disputa. O rótulo de `overdue` diverge entre o mapa e o selo (P3).

---

## 5. Relatórios

### O que está mal montado

Ver P1-2, P2-5 e P2-6. Resumo:

- o relatório é de **Invoices**, não de Demurrage;
- dois filtros não servem: "Vencidas" sempre vazio e "Rascunho" impossível;
- o USD é bruto, quando a tela mostra o líquido;
- o R$ mistura o valor flutuante com o congelado;
- a data é diferente da `/demurrage`;
- a coluna "Vencimento" sai sempre vazia;
- não há coluna de disputa, de Navio / Viagem nem de pagamento;
- a exportação não tem itens.

A data de "Emissão" usa `doc_date`, e a ordem usa `created_at`.

### Conferência cruzada de totais (C7)

Dataset depois do job; Invoices antes dos passos finais.

| Fonte | Número | Recorte |
|---|---|---|
| Aba Faturas | 11 Invoices · US$ 10.646,00 · R$ 63.492,74 | `issued`, USD líquido |
| Cartão Aguardando pagamento | R$ 63.492,74 | `issued` |
| Por Cliente e `CustomerSummaryReport` | 1 Cliente · 11 · US$ 10.646,00 · R$ 63.492,74 | `issued`, sem `paid_at` |
| Aba Pagas | 4 · US$ 3.760,00 · R$ 21.623,76 | `paid`, R$ congelado |
| Aba Canceladas | 2 · US$ 1.880,00 · R$ 10.811,88 | `cancelled` |
| Relatório (período padrão) | 17 linhas · "Total US$" **14.500,00** · "Faturado (R$)" **85.116,50** · "Recebido (R$)" 21.623,76 | US$ bruto sem canceladas; R$ = 63.492,74 flutuante + 21.623,76 congelado |
| SQL direto, líquido de Faturas + Pagas | US$ 14.406,00 | diferença de US$ 94 = desconto da DEM-0007 |
| Containers, "correndo até hoje" (antes do job) | US$ 4.080 | caixas fora listadas |
| Containers, "a faturar (previsto)" | US$ 6.740 | inclui US$ 2.820 não emissível |
| Exposição invisível antes do job | US$ 2.360 | QV-03, QV-14 e QV-15 |

### Estrutura mínima proposta (recomendação)

**1. Exposição** (o relatório que falta).

- Uma linha por caixa ainda não cobrada. Colunas:
  - Cliente, CNPJ, B/L, âncora, Navio / Viagem;
  - container e tipo;
  - descarga, devolução, dias;
  - free time e origem (B/L, acordo, tabela);
  - P1 e P2 (dias × diária);
  - US$ previsto;
  - situação: Correndo, Emitir agora, Esperando a caixa X, ou Travado com o motivo.
- Filtros: Cliente, Viagem, situação, motivo.
- Totais por Cliente.
- Quem usa: Equipamentos, para cobrar hoje, e o dono, para ver quanto está em aberto e há quanto tempo.

**2. Invoices.** Colunas:

- Invoice, tipo (Normal, Complementar de X, Substitui Y);
- B/L, âncora, Navio / Viagem, Cliente;
- emitida em (`billed_at`), paga em (`paid_at`);
- USD bruto, desconto (modo, valor, justificativa), USD líquido;
- ROE e origem; BRL hoje ou BRL congelado, em colunas separadas;
- Régua (situação e pausa), disputa (estado e próximo a responder).

Filtros por período de emissão ou de pagamento. Totais separados por natureza.

**3. Recebimentos.** Baixas (meio, TXID, data), cancelamentos de baixa e restituições, com o valor líquido recebido. Quem usa: o Financeiro, para saber o que recebeu.

**4. Exportação.** Abas Resumo, Exposição, Invoices, Itens por container (`demurrage_invoice_items`), Recebimentos e Filtros, cada uma com uma linha de totais.

**5. Onde fica.** Os relatórios podem continuar em `/relatorios`, e a `/demurrage` ganha a ligação para "Exposição". Recomendo que **Por Cliente** passe a ser a visão de exposição e saldo por Cliente, e que `CustomerSummaryReport` imprima as duas partes: faturado em aberto e a faturar.

---

## 6. Perguntas para o Lucca

1. O container **devolvido dentro do free time** deve aparecer em algum lugar de `/demurrage`? Hoje só aparece nas fichas.
2. **Por Cliente** deve mostrar a exposição não faturada (correndo e a faturar) ao lado do que já foi faturado?
3. **SOC depois de faturado:** a Invoice deve ser cancelada e reemitida sem a caixa, mantida, ou gerar um Alerta? Hoje ela é mantida, sem aviso.
4. **B/L cancelado com sobreestadia sem Invoice:** o cancelamento deve ser recusado, como já é com Invoice emitida, a cobrança deve sair mesmo assim, ou a Demurrage se perde? Hoje ela se perde sem aviso.
5. B/L com **Invoice paga** pode ser cancelado, e a Invoice continua no Portal. Está correto?
6. **Mesmo container em B/Ls de Clientes diferentes na mesma Viagem:** cobrar cada Cliente pelo valor cheio, como hoje, ratear, ou cobrar um só?
7. **Invoice cancelada com Disputa aberta:** a Disputa deve ser cancelada junto? O estado `cancelada` existe e nunca é gravado.
8. Mudança de free time (B/L, acordo, tarifa, Cliente do B/L) deve refletir **na hora** no "Em atraso", ou o job diário basta?
9. **Tipo sem tarifa:** gerar um Alerta, recusar na importação, ou usar uma tarifa padrão?
10. **"Vencida" no relatório:** remover, como diz a ADR 0014 ("não há `due_date`"), ou definir "vencida" como, por exemplo, emitida há mais de N dias sem pagamento?
11. Depois de uma Disputa **resolvida**, o Portal oferece "Abrir disputa" de novo e cria uma Disputa **nova**, sem passar por "Solicitar reabertura". É intencional?
12. Na ficha do B/L **não âncora**, a Invoice do grupo deve aparecer?

---

## 7. O que NÃO mexer

Cada item abaixo está correto, com a evidência indicada:

- **Contagem de dias e virada do atraso.** O dia é o de São Paulo, igual no banco e no front. Entra em atraso no dia descarga+free+1, sem off-by-one: `211:185`; `demurrageRates.ts:305-316`; `191:458-462`. **Runtime local:** QV-01B.
- **Chave da caixa.** Igual no front e no banco: `demurrageBoxKey.ts:6-10` contra `_demurrage_billed_container_keys` (`214:64-83`).
- **Cobrança por caixa e complementar.** Não cobra duas vezes no grupo: `existing` e `waiting_return` corretos (`472:129-227`). **Runtime local:** QV-09D (`complementary: true`, `covering_invoice_ids: [16]`) e QV-07A (`waiting_return`).
- **Datas alteradas depois da emissão.** Reemissão com `replaces_invoice_id`, suspensão com Alerta para paga ou negociada: `484:124`. **Runtime local:** QV-08A, QV-10A e QV-10B.
- **Recálculo pela PTAX e congelamento no pagamento.** `402:16`. **Runtime local:** 11 Invoices atualizadas, pagas intactas.
- **Cancelamento de B/L com Invoice emitida** recusado. **Runtime local:** QV-12A2.
- **SOC nunca em atraso; cancelamento de B/L ou Viagem tira o atraso na hora.** `200`. **Runtime local:** QV-06A e QV-12B.
- **Trava de emissão por CE e gate** (`472`, `484`): a regra está certa; falta só mostrar o motivo.
- **Portal só com Invoices `issued/overdue/paid` com CE**, sem rascunho nem cancelada (`002:437-460`). **Runtime local:** Cliente 1.
- **Matriz de permissões.** A tela oferece só o que a RPC aceita: `Demurrage.tsx:105-112` contra `docs/operations/seguranca.md` (Demurrage e Granito). A emissão é de todos os Departamentos (`472:146-150`).
- **Leitura completa da aba Containers.** Sem corte em 1000: `readAllPages`, `demurrageContainers.ts:172-180`.
- **Invalidação depois de gravar Invoice.** Ampla: `cacheEffects.ts:284-301`.
- **Nenhum caminho deixa `paid_at` com `issued`.** `reverse_demurrage_payment` e `reopen_demurrage_invoice` limpam a coluna.
- **Container faturado não some na reimportação.** FK `RESTRICT` e `container_id NOT NULL`.

---

## Limites desta revisão

- Não abri o app no navegador.
- Não rodei a suíte `npm run test:local-pg`. Usei RPCs diretas e as funções do front sobre um retrato do banco, sem PostgREST.
- RLS foi exercida só nos papéis Administrativo, Portal e `service_role`.
- Não confirmei quais tipos de container existem em produção (P1-1) nem o volume de Invoices (P2-7).
- Achados vindos das revisões auxiliares e não reproduzidos por mim estão marcados como **Suspeita** ou citados pela linha de código.
- Os scripts e o dataset sintético ficaram fora do repositório e foram apagados. O banco local foi recriado sem eles.

Não alterei código.
