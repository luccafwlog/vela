# Plano — preço fixo na importação e respostas às pendências da frente financeira

Estado: executado e arquivado em 2026-10-21 na PR luccafwlog/vela#1019
(migrations `378` a `383`). Origem: o
[plano de correções da frente financeira](2026-10-21-correcoes-frente-financeira.md)
(executado nas migrations `354` a `377`), as decisões da
[ADR 0093](../../adr/0093-tabela-vinculada-ao-bl-e-coerencia-financeira.md) e as
decisões do responsável de 2026-10-21 na revisão das importações: preço fixo
na importação (A), respostas às 13 perguntas (B) e confirmações por teste (C).
As decisões novas ficam na
[ADR 0094](../../adr/0094-preco-fixo-na-importacao.md).

Fora desta PR (frente das importações, depois do merge): portos BRNVT/BRITJ e
BRREC/BRSUA separados, LCL fora de veículos, aba VIN ignorada, efeitos de
importação (alerta, exclusão, reprocesso, ator), aviso de B/L cancelado no
arquivo de B/L, tela do aceite de refixar o preço, recusa de B/L em outra
Viagem e confirmação de faturamento do arquivo COSCO só para fatura emitida.
Esta PR não depende da junção de portos em `normalize_port_code`: o vínculo de
tabela compara o POD do B/L com o da tabela pela mesma função, e continua
certo quando ela deixar de juntar os portos.

## Panorama

"Estado antes" é o código antes desta etapa: **ok** = já implementado como
decidido; **conflita** = implementado de forma que conflita; **falta** = não
implementado. "Estado final" é o código no fim desta PR, provado pela suíte
da última coluna. A coluna "Entrega" diz o que fechou a linha.

### ADR 0093

| Decisão | Estado antes | Estado final | Onde está | O que mudar | Entrega | Suíte que prova |
|---|---|---|---|---|---|---|
| 1. B/L vinculado à tabela; POD/modo novo vincula a ativa do escopo novo | ok | já implementado como decidido | `354`: `bl_charge_table_links`, `bind_bl_local_charge_tables`, `_bl_charge_table_for_scope` | Itens da tabela nova entram no preço fixo com a Condição e o câmbio da importação (A2) | `378` | `tabelaVinculadaAoBl`, `precoFixoNaImportacao` |
| 2. Editar item/Condição é correção; só o Administrativo | ok | já implementado como decidido | `354`: `guard_tariff_correction_admin`, `reprice_bls_on_charge_item_change`, `reprice_bls_on_customer_rate_change` | — | — | `tabelaVinculadaAoBl` |
| 2. (frase final) Condição nova recalcula B/Ls sem CE | conflita (A3) | já implementado como decidido | `354`: `reprice_bls_on_customer_rate_change` (INSERT, ativar, desativar) | Criar, ativar ou desativar Condição não recalcula B/L existente | `378` | `precoFixoNaImportacao` |
| 3. Preço congelado no dia do CE; base atual na emissão | conflita (A1) | já implementado como decidido | `355`: `freeze_bl_prices_on_ce`, `bl_price_freezes` sem câmbio | Preço (tabela, Condição, data, câmbio) fixo no primeiro cálculo; base atual na emissão fica | `378` | `precoFixoNaImportacao`, `precoDoCeBaseAtual` (expectativa muda) |
| 4. Correção usa os preços da fatura | ok | já implementado como decidido | `367` (`bl_price_freezes` dos faturados), `apply_invoice_basis_changes` com `roe_frozen` | O câmbio do recebível passa a ser o fixado | `378` | `correcaoCodDesbloqueioDemurrage` |
| 5. ETA depois da emissão não muda a fatura | conflita (A1) | já implementado como decidido | `372`: `recalculate_provisional_bls_on_eta`; `359`: data pela ETA | ETA não muda preço de B/L nenhum | `378` | `precoFixoNaImportacao`, `calculoBlCanceladoIsentoEta` (expectativa muda) |
| 6 a 8. Consolidada coerente; substituída no Portal | ok | já implementado como decidido | `356`, `361` | — | — | `consolidadaCruzada`, `portalConsolidadaPaga` |
| 9. Consolidada interna com B/L sem individual | ok | já implementado como decidido | `365` | — | — | `faturamentoFechadoNaApi` |
| 10. Saldo do Vela em três linhas | ok | já implementado como decidido | `371`, ficha e lista de Clientes | — | — | `saldoDoVela` |
| 11. Avulsa no saldo do Vela | ok | já implementado como decidido | `371` | — | — | `saldoDoVela` |
| 12. Fatura cancelada solta o B/L; só o Emitir emite | ok | já implementado como decidido | `362` | — | — | `faturaCanceladaSoltaBl` |
| 13. Desvincular Cliente | ok | já implementado como decidido | `373` | — | — | `vinculoDoClienteNoBl` |
| 14. Cancelar Viagem | ok | já implementado como decidido | `363` | — | — | `viagemCanceladaFinanceiro` |
| 15. Troca de CNPJ reemite avulsa e Demurrage | ok | já implementado como decidido | `374` | — | — | `vinculoDoClienteNoBl` |
| 16. Pix sem TXID | ok no código; texto incompleto (B11) | já implementado como decidido | `375`: `itau_pix_record_untracked`, Edge `itau-pix` | Texto: vale só para Pix sem TXID nenhum | ADR 0094 | `gateReciboAvulsaPix`, `itauPix.test.ts` |
| 17. Pix em análise | ok | já implementado como decidido | `360`, `370` | — | — | `itauPixCharges`, `correcaoCodDesbloqueioDemurrage` |
| 18. Pix em duplicidade | ok | já implementado como decidido | `375` | — | — | `gateReciboAvulsaPix` |
| 19. Cancelamento com devolução integral de avulsa | ok | já implementado como decidido | `375` | — | — | `gateReciboAvulsaPix` |
| 20. Desbloqueio de CE com diferença a faturar | ok | já implementado como decidido | `369` | — | — | `correcaoCodDesbloqueioDemurrage` |
| 21. Ano do número em Brasília | ok no código; texto (B12) | já implementado como decidido | `376`: `assign_invoice_number` | Registrar quatro dígitos e o número inteiro a partir de 10.000; corrigir o "5 dígitos" da F-43 | ADR 0094 | `lote4NumeroAvulsaEstornoItau` |
| 22. Container dividido com isento | ok (fica como está) | já implementado como decidido | motor de cálculo | — | — | `auditoriaCeContainerCompartilhado` |

### A. Preço fixo na importação

| Decisão | Estado antes | Estado final | Onde está | O que mudar | Entrega | Suíte que prova |
|---|---|---|---|---|---|---|
| A1. Tabela, Condição, data e câmbio fixos no primeiro cálculo; o CE não fixa | conflita | já implementado como decidido | `355`: congela no CE e sem câmbio; `268`/`create_invoice_from_bls_core` e `sync_local_charge_receivable` usam o câmbio do dia | Fixar no primeiro cálculo, com o câmbio; emissão e recebível usam o câmbio fixado | `378` | `precoFixoNaImportacao` |
| A1. Condição pelo dia da importação; ETA não ancora | conflita | já implementado como decidido | `359`: `bl_local_charge_reference_date` pela ETA | Data de referência = dia da importação (Brasília), gravada no preço fixo | `378` | `precoFixoNaImportacao` |
| A1. ETA alterada não muda preço | conflita | já implementado como decidido | `372`: gatilho `recalculate_provisional_bls_on_eta` | Retirar o gatilho | `378` | `precoFixoNaImportacao` |
| A1. Base atual na emissão | ok | já implementado como decidido | `355`: `bl_calculation_is_current`, `refresh_unbilled_calculations` | — | — | `precoDoCeBaseAtual` |
| A2. B/L sem Cliente: Condição do Cliente vinculado vigente no dia da importação | ok em parte | já implementado como decidido | `355`: `freeze_follows_bl_customer` (pela data do CE) | Mesma regra com a data da importação | `378` | `precoFixoNaImportacao` |
| A2. Reimportação só refixa com aceite; sem aceite mantém o preço; arquivo idêntico não muda | conflita | já implementado como decidido | recálculo usa o câmbio do dia | RPC `refix_bl_local_charge_prices` (o servidor só refixa com o pedido); sem ele o preço fica | `378` | `precoFixoNaImportacao` |
| A2. POD novo antes da emissão: tabela do POD novo; Condição, câmbio e data da importação | conflita em parte | já implementado como decidido | `354` revincula; itens da tabela nova ficam fora do preço fixo | Itens da tabela nova entram no preço fixo com a data e o câmbio da importação | `378` | `precoFixoNaImportacao` |
| A3. Condição nova não recalcula B/L existente | conflita | já implementado como decidido | `354` | Ver decisão 2 (frase final) | `378` | `precoFixoNaImportacao` |
| A4. Backfill pelo "Data status" | falta | já implementado como decidido | — | Preço fixo de todo B/L com cálculo, pela data da importação e o câmbio do recebível | `378` | `precoFixoNaImportacao` |

### B. Respostas às pendências

| Decisão | Estado antes | Estado final | Onde está | O que mudar | Entrega | Suíte que prova |
|---|---|---|---|---|---|---|
| B1. Escrita direta fechada em `bl_containers`, `baplie_containers`, `vehicles`, `vazios_*`, `granite_*` | falta | já implementado como decidido | grants de `authenticated` (INSERT/UPDATE) | Revogar; liberar por coluna `bl_containers.unpacking_location`, `vazios_importacao_containers.natureza` e `vazios_export_*`; gatilhos que gravam essas tabelas passam a SECURITY DEFINER | `380` | `escritaDiretaFechada` |
| B2. RPCs revogadas na `366` | ok | já implementado como decidido | `366` | — | — | `faturamentoFechadoNaApi` |
| B3. Falha de cálculo recusa a gravação inteira | conflita | já implementado como decidido | `373` abre `billing_calculation_blocked`; arquivo de B/L enfileira `provisional_charges`; Base de Clientes, troca de Cliente, recálculo de base e Manifesto BB engolem a falha | Recusar com o B/L e o que falta; B/L sem tabela continua em espera | `379` | `falhaDeCalculoRecusa` |
| B4. B/L cancelado somente leitura em `bl_containers` e `vehicles`; planilha de datas só nos B/Ls ativos | falta | já implementado como decidido | — | Guarda nas duas tabelas; `apply_container_dates_batch_atomic` grava só nos ativos | `380` | `escritaDiretaFechada` |
| B5. Carga solta faturada: confirmação conferida no servidor com fatura e valor antes → depois; `bb_cbm` sozinho; misto não cancela | falta | já implementado como decidido | Manifesto BB trava só POL/POD; `capture_invoice_basis` não olha `bb_cbm`, volumes e máquinas | Travar peso, CBM, volumes e máquinas sem a confirmação; prévia com valor antes → depois; capturar os campos; misto avisa sem cancelar | `381` + `breakbulkImport.ts`/`BreakbulkReimportReview` | `cargaSoltaFaturada` |
| B6. POD depois do CE | ver A2 | já implementado como decidido | — | — | `378` | `precoFixoNaImportacao` |
| B7. B/L em outra Viagem | fora (importações) | fora desta PR (frente das importações) | — | — | — | — |
| B8. CE trocado | deixa de existir com A1 | já implementado como decidido | — | — | `378` | `precoFixoNaImportacao` (CE não muda preço) |
| B9. Arquivo idêntico não muda o preço | ver A2 | já implementado como decidido | — | — | `378` | `precoFixoNaImportacao` |
| B10. ROE manual da Demurrage prevalece | conflita | já implementado como decidido | `recalculate_demurrage_invoices` sobrescreve `roe_manual` | Invoice com ROE manual fora do recálculo pela PTAX; tirar o ROE manual por RPC com motivo e rastro | `382` + tela de Demurrage | `demurrageRoeManual` |
| B11. Pix com TXID de outro sistema ignorado | ok no código | já implementado como decidido | `itauPix.ts` | Texto da decisão 16 | ADR 0094 | `itauPix.test.ts` |
| B12. Número com quatro dígitos e inteiro a partir de 10.000 | ok no código | já implementado como decidido | `376` | Texto | ADR 0094 | `lote4NumeroAvulsaEstornoItau` |
| B13. Avulsa com linha em dólar: unitário só em US$, total em R$ | conflita | já implementado como decidido | item da avulsa grava unitário em R$ | Unitário em R$ vazio na linha em dólar; telas e impresso mostram o unitário em US$ | `383` + `InvoiceDetailModal`, `InvoiceDocumentLocal`, Portal | `avulsaLinhaEmDolar`, testes de componente |
| 2a. Medição da Base de Clientes | prioridade baixa | não implementado: prioridade baixa, não segura o merge | — | Medir quando houver base real | — | — |

### C. Confirmações por teste

| Item | Estado antes | Estado final | Onde está | Suíte que prova |
|---|---|---|---|---|
| C1. Vincular Cliente a B/L com CE emite na hora, salvo B/L de fatura cancelada | ok | já implementado como decidido | `trg_auto_bill_bl_after_ce_mercante`, `362` | `faturaCanceladaSoltaBl` (caso novo) |
| C2. Reativar B/L reabre os efeitos; `local_billing` reaberto de B/L com fatura cancelada devolve `skipped` | ok | já implementado como decidido | `372`, `362` | `faturaCanceladaSoltaBl` (caso novo) |

## Textos a mudar

Todos atualizados nesta PR: banners "Situação atual" nas ADRs 0093, 0040, 0070
e 0077 (o texto original fica), ADR 0094 nova e índice de ADRs; módulos
[Taxas Locais](../../modules/taxas-locais.md) (preço fixo na importação, data de
referência, Condição nova, ETA, refixar, falha no vínculo),
[Faturamento](../../modules/faturamento.md) (câmbio fixado, avulsa em dólar,
carga solta faturada, número da fatura, troca de Cliente),
[Demurrage](../../modules/demurrage.md) (ROE manual),
[Reconciliação PIX](../../modules/reconciliacao-pix.md) (decisão 16),
[Manifestos & EDI](../../modules/manifesto-edi.md) (carga solta faturada,
planilha de datas, B/L cancelado, falha de cálculo) e
[Segurança](../../operations/seguranca.md) (escrita fechada); o
[manual financeiro](../../operations/manual-financeiro.md) (seções 5 e 7) e o
[CHANGELOG](../../CHANGELOG.md); a F-43 do
[plano arquivado da frente financeira](2026-10-21-correcoes-frente-financeira.md)
ganhou nota editorial (quatro dígitos).

## Suítes que provam a regra antiga

Atualizadas para a regra nova, cada uma no caso que dizia o contrário:
`calculoBlCanceladoIsentoEta` (a ETA não recalcula mais o provisório),
`caminhoManualVigencia` (a data de referência é a do preço fixo, não a ETA),
`tabelaVinculadaAoBl` (Condição nova não recalcula B/L existente; data de
referência = dia da importação), `vinculoDoClienteNoBl` (falha de cálculo no
vínculo recusa, sem Alerta), `revisaoFinalImportacaoBl` (B/L não faturado com
recebível troca de Cliente; o recebível é anulado), `precoDoCeBaseAtual`
(título: preço fixo, não do CE), `correcoesRevisaoImportacoes` (limpeza do
cálculo que a importação agora grava), e, pela escrita direta fechada,
`escalaDocumentalStatus` e `revisaoFinalDemurrage` (gravam a carga como
`service_role` ou esperam `permission denied`). `itauPixCharges` e
`auditoriaEfeitosImportacao` não precisaram mudar: o caso de câmbio ausente
que elas exercitam não passa pelos caminhos que agora recusam.

## Execução

Migrations (cada uma com a suíte que reproduz a falha antes e passa depois):

| Migration | Entrega | Suíte nova |
|---|---|---|
| `378_preco_fixo_na_importacao` | A1 a A4, decisões 2 (frase final), 3 e 5, B6, B8, B9: preço fixo no primeiro cálculo com câmbio (`bl_price_freezes.roe`, `_bl_fixed_roe`), data de referência do preço fixo, sem gatilhos do CE e da ETA, Condição nova sem recálculo, `refix_bl_local_charge_prices`, emissão, recebível e COD pelo câmbio fixado, backfill pelo "Data status" | `precoFixoNaImportacao` (9 casos) |
| `379_falha_de_calculo_recusa_a_gravacao` | B3: `_raise_local_charge_failure`; vínculo e troca de Cliente, arquivo de B/L, Manifesto BB (calcula na gravação), Base de Clientes, ficha, CE pela ficha e recálculo de base recusam; troca de Cliente considera faturado só fatura viva, B/L faturado ou recebível com baixa (decisão 13) | `falhaDeCalculoRecusa` (8 casos) |
| `380_escrita_direta_fechada_e_cancelado_somente_leitura` | B1 e B4: grants revogados, colunas liberadas, `guard_cancelled_bl_cargo`, planilha de datas só nos B/Ls ativos | `escritaDiretaFechada` (3 casos) |
| `381_carga_solta_faturada_com_confirmacao` | B5, F-32, 2f: `preview_breakbulk_billing_changes`, trava de peso, CBM, volumes e máquinas, captura de `bb_*`, reemissão bloqueada sem cancelar | `cargaSoltaFaturada` (3 casos) e `breakbulkImport.test.ts` |
| `382_roe_manual_da_demurrage_prevalece` | B10: recálculo pula `roe_manual`; `release_demurrage_invoice_manual_roe` | `demurrageRoeManual` (2 casos) e `ManualRoeRelease.test.tsx` |
| `383_avulsa_linha_em_dolar` | B13: linha em dólar sem unitário em R$; telas e impresso pelo `invoiceItemUnit` | `avulsaLinhaEmDolar` (1 caso) e `invoiceItemUnit.test.ts` |

C1 e C2 ganharam dois casos em `faturaCanceladaSoltaBl`.

Escolhas de execução, dentro das decisões:

- **Data de referência do B/L sem tabela:** o preço fixo nasce no primeiro
  cálculo; o B/L importado sem tabela (em espera) fica com a data e o câmbio do
  dia em que a tabela aparece e ele é calculado pela primeira vez.
- **Veículo de B/L cancelado (B4):** a guarda deixa o chassi passar do B/L
  cancelado ao reemitido pelo arquivo de B/L, mudando só B/L, container e
  Viagem. É exceção provisória (`ponytail:` na `380`) até a frente das
  importações deixar de ler a aba VIN.
- **Reemissão impossível (B5):** "caso misto" é o que
  `check_bl_terminal_pendencies` acusa; a fatura fica e abre
  `fatura_desatualizada`, e a pendência guarda "Reemissão bloqueada: …".
- **Manifesto BB:** o servidor calcula na gravação os B/Ls inseridos ou
  alterados e os nunca calculados; o cálculo da tela continua (redundante).

Evidência (Postgres 16 local, `scripts/setup-local-pg.sh --reset`, cadeia
completa até a `383`):

- **Bateria local-pg completa** (`npm run test:local-pg`): 143 arquivos, 1220
  casos, todos verdes.
- **Reprodução antes da mudança:** banco recriado só até a `377` e as suítes
  novas com `LOCAL_PG_REPRO=1`: 25 casos falham (preço que segue ETA e
  Condição nova, câmbio do dia, vínculo gravado com câmbio ausente,
  `authenticated` com INSERT nas tabelas de carga, data gravada no B/L
  cancelado, ROE manual sobrescrito pela PTAX, unitário em R$ na linha em
  dólar, funções que não existiam) e 5 passam: C1, C2, os dois casos
  anteriores de `faturaCanceladaSoltaBl` e "B/L sem tabela não é falha", que
  já valiam. Com a cadeia completa, os 34 casos dessas suítes passam.
- `npm run docs:check`, `typecheck`, `lint`, `npm test` (818 arquivos),
  `build`, `design:check`, `a11y:contrast`, `migrations:check`, `rpc:check` e
  `git diff --check` verdes.

Não verificado aqui: aplicação das migrations no Supabase (staging ou
produção), o backfill da `378` sobre os dados reais de teste e o fluxo na
tela com navegador.

## Ao concluir

Concluído: plano movido para `docs/archive/plans/`, linha retirada de
[`docs/plans/README.md`](../../plans/README.md) e entrega registrada no
[CHANGELOG](../../CHANGELOG.md).
