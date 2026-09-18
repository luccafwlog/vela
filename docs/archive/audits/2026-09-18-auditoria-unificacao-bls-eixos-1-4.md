# Auditoria técnica e de UX — unificação de B/Ls (contêiner, carga solta e misto)

- **Data:** 2026-09-18
- **Alvo:** `main` @ `7c7984a` (PR 698 integrada, mais `6e06913`, `b2742d1`, `7c7984a`)
- **Eixos:** 1) regressão/fidelidade dos parsers · 2) tabela unificada `/bls` ·
  3) linha expansível · 4) tela de detalhe `/bls/:blId`
- **Método:** leitura do código vivo e das migrations 054/059/060/061/062/063, sondas executáveis
  contra os parsers reais e os modelos versionados em `public/templates/`, e replay das migrations
  em PostgreSQL 16 descartável (`scripts/setup-local-pg.sh --reset`).

Documento histórico. Não é fonte de verdade sobre o comportamento atual. **Todos os achados abaixo
foram remediados na mesma entrega**; o estado corrente está em `docs/RASTREABILIDADE.md`
("Cubagem, formato numérico e linha expansível de B/Ls — 2026-09-18").

## Sumário

A unificação estava sólida no que prometeu: semântica de peso disjunta e correta (061/062/063),
`cargo_mode` derivado por trigger em todos os caminhos de escrita, importadores sem espelhamento de
peso. **Nenhuma regressão causada pela PR 698 foi encontrada nos parsers.** Os achados são de outra
natureza:

1. A 061 consertou o peso e deixou o CBM com o mesmo defeito de duas semânticas (A4).
2. O modelo de planilha que a própria tela oferece não passava pelo parser do qual é modelo: peso e
   cubagem entravam ×1000, sem erro, e alimentavam a taxa por tonelada (A1). Defeito **anterior** à
   PR 698, exposto por ela.
3. A compressão da tabela era reversível de graça: três KPIs já buscados e descartados (B1), e a RPC
   já devolvia contêineres e itens em memória (Eixo 3).
4. Não existia aba `Carga` (D1).

## Eixo 1 — parsers e ingestão

| ID | Sev. | Achado | Remediação |
|---|---|---|---|
| A1 | P0 | `parseNumber` fixava pt-BR. `259.312` (notação dos modelos `carga-solta-modelo.{csv,xlsx}`) virava 259 312 t sem erro de linha e seguia para `resolve_bl_local_charge_items` na base `weight_ton`. O `.csv` importava 2 de 3 linhas com fator mil; o `.xlsx` falhava diferente. A linha rejeitada acusava "colunas obrigatórias ausentes", que não era a causa. | `inferSeparatorFormat` decide o separador pela evidência do arquivo; sem evidência lê em pt-BR e emite `rowError` `warning` com o valor exato que entrou. Modelos regravados com vírgula decimal e uma casa que desempata. `manifesto-bb-modelo.csv`, que era **rejeitado por inteiro** sob pt-BR fixo, passou a importar. |
| A2 | P1 | Layout carrier aceitava peso e cubagem ilegíveis em silêncio (`?? 0`), ao contrário de resumido e legado, que rejeitam a linha. | Peso ilegível vira `rowError` bloqueante; cubagem ausente vira `warning`. |
| A3 | P1 | `total_cbm` era a única métrica BB fora do `ON CONFLICT` do importador: reimportar manifesto com CBM corrigido atualizava tudo menos a cubagem. | `bb_cbm` entrou no `INSERT` e no `ON CONFLICT` (migration 064). |
| A4 | P1 | `bls.total_cbm` tinha dois donos — `breakbulkImport` (carga solta) e `blFreightImport` (soma dos contêineres) — um sobrescrevendo o outro em B/L misto, e a ficha exibia o resultado sob "Resumo da carga solta". | Migration 064: `total_cbm` só contêiner, `bb_cbm` só carga solta, `blTotalCbm()` para o documento inteiro, `breakbulkCbm` no resumo operacional. |
| A5 | P2 | Reimportação atualiza `manifest_customer_name` e preserva `consignee` (deliberado), sem sinalizar a divergência. | A ficha mostra a divergência no campo Consignatário, explicando por que a preservação é intencional. |
| A6 | — | Premissa do escopo incorreta: `ceMercanteImport` não extrai contêiner, lacre, tara, peso nem frete — mapeia `BL` e `CE MERCANTE`. Extração física é de `blFreightImport`/`blDocumentParser`, verificados íntegros. | Sem ação de código. |
| A7 | P3 | `bb_weight_ton numeric(12,3)`: conversão kg→ton perde frações de quilo no cabeçalho. Itens guardam o kg exato. | Aceito e registrado. |
| A8 | P2 | `bb_machine_qty` e `total_cbm` não contavam como sinal de carga solta: um B/L declarado só com máquinas e cubagem sobrevivia ao INSERT mas era reclassificado como `container` no primeiro UPDATE de peso/volumes. | Migration 064: as duas colunas entraram no sinal e na cláusula `UPDATE OF` do trigger. |
| A9 | P2 | O `catch` genérico de `useBlEditForm` descartava a mensagem do banco, inclusive o `ERRCODE P0003` ("remover conteúdo exige estorno/refaturamento"). | `P0003` e o detalhe do erro chegam ao toast. |

**Semântica de peso misto (054/061/062/063): verificada e correta**, sem ação necessária.

## Eixo 2 — tabela `/bls`

Perdidas na unificação, em relação a `/carga-solta`: colunas Máquinas, Volumes, Total de volumes,
CBM, Shipper e Notify; KPIs Máquinas, Total de volumes e CBM. Peso foi comprimido no badge `Carga`.
Ganhos: POL, POD, Perfil, seleção em massa e três KPIs novos. Nada se perdeu do banco — o export
mantém a aba `CargaSolta` completa.

| ID | Sev. | Achado | Remediação |
|---|---|---|---|
| B1 | P1 | `totalMachines`, `totalPackages` e `totalCbm` eram calculados pela RPC, tipados, mapeados — e descartados sem renderizar. | Três `MetricCard` restaurados, visíveis fora da lente de contêiner puro. |
| B2 | P1 | `/carga-solta` virou redirect mas `/containers` sobreviveu como lente dedicada: o operador de contêiner manteve uma tela no seu grão de trabalho, o de carga solta ficou com uma linha por documento e um badge. | Fechado pela linha expansível (Eixo 3), sem rota nova. |
| B3 | P2 | `toFixed(1)` escrevia `12.3 ton` num app pt-BR, sem separador de milhar (`135263 ton`) e truncando as três casas declaradas. | `formatBlCargoBadge` extraído para `src/lib/blCargoBadge.ts`, com `toLocaleString('pt-BR')`. |
| B4 | P2 | B/L misto sem número de contêiner legível escapava para o `return` final e imprimia `0 CNTR`, descartando a carga solta. | Ramo eliminado: a modalidade é lida pelos predicados compartilhados. |
| B5 | P2 | `fetchAllBls` reimplementava os filtros com busca textual mais estreita que a RPC: buscar por nome de cliente exibia linhas e exportava zero. | `fetchAllBls` pagina a mesma RPC; o dialeto antigo foi removido. |
| B6 | P3 | Nada dizia que as lentes Contêiner e Carga Solta incluem B/Ls mistos. | Nota abaixo dos KPIs. |

## Eixo 3 — linha expansível

Premissa do escopo corrigida: **`blSelect` não alimentava a tabela** — quem alimenta é
`operational_list_bls`, que projeta `to_jsonb(bc)`/`to_jsonb(bb)`, isto é, todas as colunas. O
accordion não custou uma query. O obstáculo era de tipo (`discharge_date` ausente do `Pick` de
`BLListItem`) e de CSS: a linha de detalhe é um `<td colSpan>` que também é `:last-child` e herdaria
`position: sticky` de `app-table--sticky-actions`.

Implementado em `src/components/bl/BlRowDetail.tsx`, com o padrão da casa
(`ValidacaoOperationsTable`), `aria-expanded`/`aria-controls`, opt-out de CSS via
`tr[data-row-detail]`, contagem de colunas em constante única e layout alternativo em telas
estreitas. O toggle é botão próprio, então a seleção em massa segue intacta.

## Eixo 4 — ficha do B/L

| ID | Sev. | Achado | Remediação |
|---|---|---|---|
| D1 | P1 | Não existia aba `Carga`: o conteúdo de carga ficava no fim da aba "Detalhes do B/L", abaixo de ~25 campos de formulário. | Aba própria (`?tab=carga`) entre Visão Geral e Detalhes, e badge de modalidade no topo. |
| D2 | P2 | `'Misto'` e `'Misto (CNTR + Carga Solta)'` para a mesma modalidade. | Rótulo único (`cargoModeLabel`). |
| D3 | P2 | A Visão Geral recebia `isContainerMode` e redecidia a modalidade com uma terceira regra, diferente do trigger e de `resolveCargoMode`; e não mostrava CBM em nenhum ramo. | Recebe `cargoMode`, usa os predicados compartilhados e exibe CBM. |
| D4 | P2 | "Itens legados vinculados" para itens que todo import com detalhe produz; mensagem de vazio afirmando uma causa que nem sempre é a real. | "Itens da carga solta" e mensagem que descreve o estado. |
| D5 | P3 | `tare_weight_kg` capturada, persistida e tipada — nunca exibida. | Exibida na aba Carga e na linha expansível. |
| D6 | — | Edição manual verificada: campos BB sob `!isContainerMode`, peso de contêiner sob `hasContainers`; num B/L misto os dois conjuntos aparecem e são independentes. | Mantido, com rótulos explícitos por modalidade e `bb_cbm` editável. |
| D7 | P3 | `resolveCargoMode` ignorava volumes, máquinas e cubagem no fallback, divergindo do banco. | Alinhado ao sinal de `_recalculate_bl_cargo_mode`. |

## Eixo 5 — testes

**Nota de método:** boa parte dos `*Migration.test.ts` afere o **texto** do SQL por regex — a
convenção do repositório chama isso de **Teste de contrato SQL**, não `Teste`. O comportamento real
dos triggers só é interrogado nos `*.local-pg.test.ts`, que a suíte padrão pula. Os achados de banco
desta auditoria viviam nessa faixa cega.

Acrescentados: `breakbulkTemplateNumberFormat.test.ts` (modelos versus parser, e carrier sem peso),
`importNumber.test.ts` (inferência de separador), `blCargoBadge.test.ts` (locale, truncamento e o
`0 CNTR`), `Bls.test.tsx` (accordion, a11y, não-interferência com seleção, KPIs),
`cargoMode.test.ts` (`blTotalCbm`), `useBls.test.ts` (export pela mesma RPC) e
`blCbmSemantics.local-pg.test.ts` (triggers e RPC da 064 contra PostgreSQL real).

**Achado operacional da suíte:** os `*.local-pg.test.ts` compartilham um banco e **não são seguros em
paralelo** — `financialBattery` e `importEffects` falham em execução paralela e passam em série
(`--no-file-parallelism`). Não é regressão; é característica do arranjo.

## Notas

- **Premissas do escopo corrigidas:** `blSelect` não alimentava `/bls`; não existia aba `Carga`;
  `ceMercanteImport` não extrai dado físico de contêiner.
- **Não coberto:** desempenho da RPC com filhos projetados por linha, e o accordion com B/Ls de
  centenas de contêineres. Se houver lentidão, o corte natural é limitar o painel a N linhas.
- **Teto conhecido:** sem evidência no arquivo, o import BB lê em pt-BR e avisa. O desempate
  definitivo é um seletor de formato no modal — registrado como `ponytail:` em
  `breakbulkManifestParser.ts`.
