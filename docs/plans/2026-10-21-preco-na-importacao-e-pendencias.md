# Plano — preço fixo na importação e respostas às pendências da frente financeira

Estado: vivo; panorama montado em 2026-10-21, implementação em andamento na PR
luccafwlog/vela#1019. Origem: o
[plano de correções da frente financeira](../archive/plans/2026-10-21-correcoes-frente-financeira.md)
(executado nas migrations `354` a `377`), as decisões da
[ADR 0093](../adr/0093-tabela-vinculada-ao-bl-e-coerencia-financeira.md) e as
decisões do responsável de 2026-10-21 na revisão das importações: preço fixo
na importação (A), respostas às 13 perguntas (B) e confirmações por teste (C).
As decisões novas ficam na
[ADR 0094](../adr/0094-preco-fixo-na-importacao.md).

Fora desta PR (frente das importações, depois do merge): portos BRNVT/BRITJ e
BRREC/BRSUA separados, LCL fora de veículos, aba VIN ignorada, efeitos de
importação (alerta, exclusão, reprocesso, ator), aviso de B/L cancelado no
arquivo de B/L, tela do aceite de refixar o preço, recusa de B/L em outra
Viagem e confirmação de faturamento do arquivo COSCO só para fatura emitida.
Esta PR não depende da junção de portos em `normalize_port_code`: o vínculo de
tabela compara o POD do B/L com o da tabela pela mesma função, e continua
certo quando ela deixar de juntar os portos.

## Panorama

Classes do estado no código antes desta etapa: **ok** = já implementado como
decidido; **conflita** = implementado de forma que conflita; **falta** = não
implementado. A coluna "Entrega" diz o que fecha a linha nesta PR.

### ADR 0093

| Decisão | Estado | Onde está | O que mudar | Entrega | Suíte que prova |
|---|---|---|---|---|---|
| 1. B/L vinculado à tabela; POD/modo novo vincula a ativa do escopo novo | ok | `354`: `bl_charge_table_links`, `bind_bl_local_charge_tables`, `_bl_charge_table_for_scope` | Itens da tabela nova entram no preço fixo com a Condição e o câmbio da importação (A2) | `378` | `tabelaVinculadaAoBl`, `precoFixoNaImportacao` |
| 2. Editar item/Condição é correção; só o Administrativo | ok | `354`: `guard_tariff_correction_admin`, `reprice_bls_on_charge_item_change`, `reprice_bls_on_customer_rate_change` | — | — | `tabelaVinculadaAoBl` |
| 2. (frase final) Condição nova recalcula B/Ls sem CE | conflita (A3) | `354`: `reprice_bls_on_customer_rate_change` (INSERT, ativar, desativar) | Criar, ativar ou desativar Condição não recalcula B/L existente | `378` | `precoFixoNaImportacao` |
| 3. Preço congelado no dia do CE; base atual na emissão | conflita (A1) | `355`: `freeze_bl_prices_on_ce`, `bl_price_freezes` sem câmbio | Preço (tabela, Condição, data, câmbio) fixo no primeiro cálculo; base atual na emissão fica | `378` | `precoFixoNaImportacao`, `precoDoCeBaseAtual` (expectativa muda) |
| 4. Correção usa os preços da fatura | ok | `367` (`bl_price_freezes` dos faturados), `apply_invoice_basis_changes` com `roe_frozen` | O câmbio do recebível passa a ser o fixado | `378` | `correcaoCodDesbloqueioDemurrage` |
| 5. ETA depois da emissão não muda a fatura | conflita (A1) | `372`: `recalculate_provisional_bls_on_eta`; `359`: data pela ETA | ETA não muda preço de B/L nenhum | `378` | `precoFixoNaImportacao`, `calculoBlCanceladoIsentoEta` (expectativa muda) |
| 6 a 8. Consolidada coerente; substituída no Portal | ok | `356`, `361` | — | — | `consolidadaCruzada`, `portalConsolidadaPaga` |
| 9. Consolidada interna com B/L sem individual | ok | `365` | — | — | `faturamentoFechadoNaApi` |
| 10. Saldo do Vela em três linhas | ok | `371`, ficha e lista de Clientes | — | — | `saldoDoVela` |
| 11. Avulsa no saldo do Vela | ok | `371` | — | — | `saldoDoVela` |
| 12. Fatura cancelada solta o B/L; só o Emitir emite | ok | `362` | — | — | `faturaCanceladaSoltaBl` |
| 13. Desvincular Cliente | ok | `373` | — | — | `vinculoDoClienteNoBl` |
| 14. Cancelar Viagem | ok | `363` | — | — | `viagemCanceladaFinanceiro` |
| 15. Troca de CNPJ reemite avulsa e Demurrage | ok | `374` | — | — | `vinculoDoClienteNoBl` |
| 16. Pix sem TXID | ok no código; texto incompleto (B11) | `375`: `itau_pix_record_untracked`, Edge `itau-pix` | Texto: vale só para Pix sem TXID nenhum | ADR 0094 | `gateReciboAvulsaPix`, `itauPix.test.ts` |
| 17. Pix em análise | ok | `360`, `370` | — | — | `itauPixCharges`, `correcaoCodDesbloqueioDemurrage` |
| 18. Pix em duplicidade | ok | `375` | — | — | `gateReciboAvulsaPix` |
| 19. Cancelamento com devolução integral de avulsa | ok | `375` | — | — | `gateReciboAvulsaPix` |
| 20. Desbloqueio de CE com diferença a faturar | ok | `369` | — | — | `correcaoCodDesbloqueioDemurrage` |
| 21. Ano do número em Brasília | ok no código; texto (B12) | `376`: `assign_invoice_number` | Registrar quatro dígitos e o número inteiro a partir de 10.000; corrigir o "5 dígitos" da F-43 | ADR 0094 | `lote4NumeroAvulsaEstornoItau` |
| 22. Container dividido com isento | ok (fica como está) | motor de cálculo | — | — | `auditoriaCeContainerCompartilhado` |

### A. Preço fixo na importação

| Decisão | Estado | Onde está | O que mudar | Entrega | Suíte que prova |
|---|---|---|---|---|---|
| A1. Tabela, Condição, data e câmbio fixos no primeiro cálculo; o CE não fixa | conflita | `355`: congela no CE e sem câmbio; `268`/`create_invoice_from_bls_core` e `sync_local_charge_receivable` usam o câmbio do dia | Fixar no primeiro cálculo, com o câmbio; emissão e recebível usam o câmbio fixado | `378` | `precoFixoNaImportacao` |
| A1. Condição pelo dia da importação; ETA não ancora | conflita | `359`: `bl_local_charge_reference_date` pela ETA | Data de referência = dia da importação (Brasília), gravada no preço fixo | `378` | `precoFixoNaImportacao` |
| A1. ETA alterada não muda preço | conflita | `372`: gatilho `recalculate_provisional_bls_on_eta` | Retirar o gatilho | `378` | `precoFixoNaImportacao` |
| A1. Base atual na emissão | ok | `355`: `bl_calculation_is_current`, `refresh_unbilled_calculations` | — | — | `precoDoCeBaseAtual` |
| A2. B/L sem Cliente: Condição do Cliente vinculado vigente no dia da importação | ok em parte | `355`: `freeze_follows_bl_customer` (pela data do CE) | Mesma regra com a data da importação | `378` | `precoFixoNaImportacao` |
| A2. Reimportação só refixa com aceite; sem aceite mantém o preço; arquivo idêntico não muda | conflita | recálculo usa o câmbio do dia | RPC `refix_bl_local_charge_prices` (o servidor só refixa com o pedido); sem ele o preço fica | `378` | `precoFixoNaImportacao` |
| A2. POD novo antes da emissão: tabela do POD novo; Condição, câmbio e data da importação | conflita em parte | `354` revincula; itens da tabela nova ficam fora do preço fixo | Itens da tabela nova entram no preço fixo com a data e o câmbio da importação | `378` | `precoFixoNaImportacao` |
| A3. Condição nova não recalcula B/L existente | conflita | `354` | Ver decisão 2 (frase final) | `378` | `precoFixoNaImportacao` |
| A4. Backfill pelo "Data status" | falta | — | Preço fixo de todo B/L com cálculo, pela data da importação e o câmbio do recebível | `378` | `precoFixoNaImportacao` |

### B. Respostas às pendências

| Decisão | Estado | Onde está | O que mudar | Entrega | Suíte que prova |
|---|---|---|---|---|---|
| B1. Escrita direta fechada em `bl_containers`, `baplie_containers`, `vehicles`, `vazios_*`, `granite_*` | falta | grants de `authenticated` (INSERT/UPDATE) | Revogar; liberar por coluna `bl_containers.unpacking_location`, `vazios_importacao_containers.natureza` e `vazios_export_*`; gatilhos que gravam essas tabelas passam a SECURITY DEFINER | `380` | `escritaDiretaFechada` |
| B2. RPCs revogadas na `366` | ok | `366` | — | — | `faturamentoFechadoNaApi` |
| B3. Falha de cálculo recusa a gravação inteira | conflita | `373` abre `billing_calculation_blocked`; arquivo de B/L enfileira `provisional_charges`; Base de Clientes, troca de Cliente, recálculo de base e Manifesto BB engolem a falha | Recusar com o B/L e o que falta; B/L sem tabela continua em espera | `379` | `falhaDeCalculoRecusa` |
| B4. B/L cancelado somente leitura em `bl_containers` e `vehicles`; planilha de datas só nos B/Ls ativos | falta | — | Guarda nas duas tabelas; `apply_container_dates_batch_atomic` grava só nos ativos | `380` | `escritaDiretaFechada` |
| B5. Carga solta faturada: confirmação conferida no servidor com fatura e valor antes → depois; `bb_cbm` sozinho; misto não cancela | falta | Manifesto BB trava só POL/POD; `capture_invoice_basis` não olha `bb_cbm`, volumes e máquinas | Travar peso, CBM, volumes e máquinas sem a confirmação; prévia com valor antes → depois; capturar os campos; misto avisa sem cancelar | `381` + `breakbulkImport.ts`/`BreakbulkReimportReview` | `cargaSoltaFaturada` |
| B6. POD depois do CE | ver A2 | — | — | `378` | `precoFixoNaImportacao` |
| B7. B/L em outra Viagem | fora (importações) | — | — | — | — |
| B8. CE trocado | deixa de existir com A1 | — | — | `378` | `precoFixoNaImportacao` (CE não muda preço) |
| B9. Arquivo idêntico não muda o preço | ver A2 | — | — | `378` | `precoFixoNaImportacao` |
| B10. ROE manual da Demurrage prevalece | conflita | `recalculate_demurrage_invoices` sobrescreve `roe_manual` | Invoice com ROE manual fora do recálculo pela PTAX; tirar o ROE manual por RPC com motivo e rastro | `382` + tela de Demurrage | `demurrageRoeManual` |
| B11. Pix com TXID de outro sistema ignorado | ok no código | `itauPix.ts` | Texto da decisão 16 | ADR 0094 | `itauPix.test.ts` |
| B12. Número com quatro dígitos e inteiro a partir de 10.000 | ok no código | `376` | Texto | ADR 0094 | `lote4NumeroAvulsaEstornoItau` |
| B13. Avulsa com linha em dólar: unitário só em US$, total em R$ | conflita | item da avulsa grava unitário em R$ | Unitário em R$ vazio na linha em dólar; telas e impresso mostram o unitário em US$ | `383` + `InvoiceDetailModal`, `InvoiceDocumentLocal`, Portal | `avulsaLinhaEmDolar`, testes de componente |
| 2a. Medição da Base de Clientes | prioridade baixa | — | Medir quando houver base real | — | — |

### C. Confirmações por teste

| Item | Estado | Onde está | Suíte que prova |
|---|---|---|---|
| C1. Vincular Cliente a B/L com CE emite na hora, salvo B/L de fatura cancelada | ok | `trg_auto_bill_bl_after_ce_mercante`, `362` | `faturaCanceladaSoltaBl` (caso novo) |
| C2. Reativar B/L reabre os efeitos; `local_billing` reaberto de B/L com fatura cancelada devolve `skipped` | ok | `372`, `362` | `faturaCanceladaSoltaBl` (caso novo) |

## Textos a mudar

- ADR 0093: banner "Situação atual" apontando a ADR 0094 (decisões 2, 3, 5, 16
  e 21); o texto original fica.
- ADR 0040: banner — a ETA deixa de ancorar a Condição; a data de referência é
  o dia da importação.
- ADR 0070: banner — a nota "Taxas do dia do CE" passa a "preço da
  importação".
- ADR 0077: banner — a correção usa os preços e o câmbio fixados.
- Módulos: Taxas Locais (data de referência, preço fixo, Condição nova,
  ETA, refixar), Faturamento (câmbio da emissão, avulsa em dólar, carga solta
  faturada), Demurrage (ROE manual), Reconciliação PIX (decisão 16),
  Manifesto/EDI (carga solta faturada, planilha de datas), Segurança (escrita
  fechada); manual financeiro e CHANGELOG.
- Plano arquivado da frente financeira: F-43 corrigida (quatro dígitos).

## Suítes que provam a regra antiga

`precoDoCeBaseAtual` (preço congelado no CE), `calculoBlCanceladoIsentoEta`
(ETA recalcula o provisório), `vinculoDoClienteNoBl` (falha de cálculo no
vínculo abre Alerta), `tabelaVinculadaAoBl` (Condição nova recalcula B/L sem
CE), `itauPixCharges` e `auditoriaEfeitosImportacao` (falta de câmbio na
importação vira efeito). A lista final, com as que a bateria completa
apontar, fica na seção "Execução".

## Ao concluir

Mover este plano para `docs/archive/plans/`, retirar a linha de
[`README.md`](README.md) e registrar a entrega no
[CHANGELOG](../CHANGELOG.md).
