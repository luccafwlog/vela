# Plano — correções da frente financeira (revisão de 2026-10-21)

Estado: vivo, nada executado. Decisões em
[ADR 0093](../adr/0093-tabela-vinculada-ao-bl-e-coerencia-financeira.md)
(citadas aqui como "decisão N").

## Origem e evidência

Revisão somente leitura da frente financeira (cálculo, emissão, consolidada,
saldos, baixa Pix e manual, avulsa, cancelamentos, correção, restituição,
gate, COD, Demurrage, fila de efeitos e alertas), feita em 2026-10-21 sobre a
`main` em `806d2b5` e conferida contra a `staging` em `99e783c`, que não altera
nenhuma das funções citadas abaixo, salvo onde indicado.

- **Ambiente:** PostgreSQL 16 local descartável (`scripts/setup-local-pg.sh
  --reset`, 342 migrations ativas), uma cópia por área, dados sintéticos. Nada
  em produção ou staging; Itaú simulado (`itau_pix_record` e fetch falso);
  Edge Functions só lidas.
- **Linha de base:** 34 suítes financeiras local-pg (269 testes) e
  `financialBattery` isolada (3 testes) passaram. Os defeitos abaixo estão em
  cenários que nenhuma suíte monta.
- **Labels** ([CONVENCOES](../CONVENCOES.md#labels-de-evidência)): **Código**
  (leitura da última definição); **Teste** (script SQL próprio no Postgres
  local, com o resultado observado; não é suíte do repositório salvo quando
  dito); **Suspeita** (não verificado).
- As funções são citadas pela migration que as define por último.

## Ordem de execução

```mermaid
flowchart LR
  L0["Lote 0: vínculo do B/L à tabela (decisão 1)"] --> L1
  L1["Lote 1: críticos F-01 a F-08"] --> L2["Lote 2: altos F-09 a F-22"]
  L2 --> L3["Lote 3: médios F-23 a F-42"]
  L3 --> L4["Lote 4: baixos e documentação"]
```

O lote 0 vem primeiro porque F-01, F-02, F-17 e as decisões 2 a 5 dependem de o
B/L guardar a sua tabela. Cada tarefa entrega migration, teste local-pg que
reproduz o achado antes da correção e passa depois, e a atualização do módulo
dono ([Taxas Locais](../modules/taxas-locais.md),
[Faturamento](../modules/faturamento.md),
[Reconciliação PIX](../modules/reconciliacao-pix.md),
[Portal do Cliente](../modules/portal-cliente.md),
[Demurrage](../modules/demurrage.md),
[Manual financeiro](../operations/manual-financeiro.md)). Toda migration que
reescreve linhas declara a dependência do "Data status" do AGENTS.md.

## Já tratado na staging (não refazer)

| Achado | O que a staging corrigiu | O que resta |
|---|---|---|
| F-39 alertas que não fecham | `import_effect_blocked` fecha ao sair de bloqueado (migration `348`); `demurrage_invoice_dates_changed` fecha quando a reemissão cobre as caixas e aceita justificativa (`349`) | `portal_reprocessamento_falhou` só fecha com outro reprocessamento |
| F-53 alertas manuais | B/L faturado, cancelado ou excluído fecha ou apaga os alertas de faturamento dele (`347`) | `upsert_billing_alert` aberto a qualquer usuário ativo; `resolve_stale_invoice` com justificativa de 3 caracteres |
| F-09 baixa Itaú | Pix recebido sem baixa aparece no painel de alertas financeiros ([PR #1010](https://github.com/luccafwlog/vela/pull/1010)) | Detecção da consulta parada (ver F-09) |

## Lote 0 — vínculo do B/L à tabela (decisão 1)

- **Hoje (Código):** `charge_calculations` guarda `charge_table_id` por linha,
  mas cada recálculo escolhe de novo a tabela ativa do escopo
  (`resolve_local_charge_table_id`, `002`; `resolve_bl_local_charge_table_ids`,
  `056`; ADR 0040, decisão 2).
- **Mudança:** gravar no B/L a tabela de cada escopo (container e carga solta)
  no primeiro cálculo; o motor (`resolve_bl_local_charge_items`, `248`) usa a
  vinculada; mudança de modo ou POD vincula ao escopo novo; desativar a tabela
  não desvincula. Preencher os B/Ls existentes pela tabela do último cálculo.
- **Junto:** edição de item ou Condição só pelo Administrativo (decisão 2;
  hoje policy `is_active_user()`, ADR 0085 D6, migration `254`), com aviso na
  tela; a edição recalcula os não faturados vinculados e reemite as faturas sem
  pagamento, e as pagas abrem Fatura desatualizada.
- **Teste:** B/L calculado na Tabela A; Tabela B ativada; recálculo continua em
  A; B/L novo vai para B; edição de item de A reemite a fatura sem pagamento de
  A e abre Fatura desatualizada na paga.

## Lote 1 — críticos (perda de dinheiro ou cobrança errada)

### F-01 — Container compartilhado cobrado 150% ou 50% na emissão que reaproveita o cálculo do CE

- **Evidência (Código):** reuse em `_auto_bill_bl_core` (`181`:905-915);
  `_reprocess_customer_held_billing` com reuse (`085`:559-560); o efeito
  `local_charges` exclui irmãos com CE ou retidos (`178`:159);
  `guard_shared_container_invoice` grava o rateio atual, não o usado nas linhas
  (`191`:68-69); o ponytail de `176`:29-31 ("refeito pela Liberação") é falso.
- **Teste (reproduzido por dois revisores, cada um no seu banco):** CE de P1
  pela planilha com o Cliente sem Portal (THD 1.000, retido); P2 importado no
  mesmo container (P2 com 0,5); Liberação: P1 faturado em 1.700 com THD 1.000;
  CE de P2: 1.150 com THD 500. O container pagou THD de 1.500. Com o irmão
  cancelado antes da Liberação, sai com 50%.
- **Correção (decisão 3):** na emissão com reuse, manter o preço do dia do CE e
  recalcular a base (quantidades e rateio); recalcular os irmãos não faturados,
  inclusive retidos ou com CE, quando a composição do container muda; a guarda
  passa a comparar o rateio cobrado.
- **Teste que fecha:** `auditoriaCeContainerCompartilhado` ou
  `portalBillingRelease` — irmão chega e é cancelado com o B/L retido; o
  container é cobrado uma vez.

### F-02 — Correção do B/L entre o CE e a emissão não entra na fatura

- **Evidência (Código):** reuse aceita `calculated`, `reviewed`,
  `ready_for_billing`, `review_required` e `exempt` (`181`:910-915);
  `save_bl_review` (`177`:346, `271`:23) não recalcula nem marca
  `not_calculated`; sem fatura viva, `_capture_invoice_basis` não captura
  (`136`:181).
- **Teste:** B/L com veículo retido (1.700); Movement To vira LCL e a cotação
  passa a `exempt`; a Liberação emite 1.700. O inverso (isento no CE que passa a
  cobrável não fatura) está só no Código.
- **Correção (decisão 3):** escritor de campo lido pelo motor em B/L não
  faturado recalcula a base na transação ou marca `not_calculated`, e o reuso
  recalcula a base com o preço do dia do CE.
- **Teste que fecha:** `portalBillingRelease` — B/L retido corrigido na ficha
  antes da Liberação.

### F-03 — Pagamento parcial desalinha consolidada e individuais

- **Evidência (Código):** `register_ledger_invoice_payment_legacy_052`
  (`247`:700-760) só reprojeta a fatura paga; os efeitos cruzados
  (`247`:755-830) só rodam com `paid`.
- **Teste:** parcial na consolidada → individuais `issued` com saldo e QR
  cheios; o QR da individual quitada vai para review, o da parcialmente coberta
  gera restituição e torna obsoleta a consolidada já com R$ 150 recebidos.
  Parcial na individual → a consolidada mantém QR e saldo antigos, e o Cliente
  paga R$ 40 a mais, com restituição. No Portal, a lista lê o razão e o detalhe
  e o QR leem a projeção (lista 160, QR 200).
- **Correção (decisão 6):** depois de cada alocação, reprojetar todas as
  faturas ligadas aos recebíveis alterados (saldo pelos vínculos ativos;
  individual quitada vira `covered`), o que reemite os QRs pelo gatilho de Pix.
- **Teste que fecha:** nova `consolidadaCruzada.local-pg.test.ts` — os dois
  sentidos, com Itaú simulado.

### F-04 — "Cancelar baixa" revive todas as consolidadas obsoletas do recebível

- **Evidência (Código):** corpo de `_reverse_invoice_payment_impl_109`
  (`019`:452-480, chamado por `reverse_invoice_payment`, `241`:1097); o ramo
  "consolidada paga" muda vínculos de outras consolidadas abertas
  (`247`:759-777).
- **Teste:** C0 desfeita pelo Portal, C1, I1 paga (C1 obsoleta), C2 só com A2;
  estorno → C0 e C1 voltam a `issued` com cobranças de R$ 200; pagar C0 deixa A2
  aberto sem documento pagável; Portal 600 contra 500.
- **Correção:** reviver só a consolidada obsoletada por aquele pagamento
  (`invoice_lifecycle_events.payload.paid_invoice_id`) e só se nenhum recebível
  dela estiver noutra consolidada aberta; restrição de uma consolidada aberta
  por recebível; o ramo `covered` mexe só nos vínculos da própria fatura.
- **Teste que fecha:** `consolidadaCruzada` — estorno depois de reconsolidar.

### F-05 — O mesmo Pix de avulsa é baixado duas vezes, com restituição falsa

- **Evidência (Código):** `itau_pix_settle` (`153`:238-241) chama
  `register_verified_invoice_payment`, que aceita avulsa `paid` (`247`:1377) e
  não confere `invoices.pix_txid` (gravado pelo extrato em `247`:302-318) nem
  pagamento com o mesmo endToEndId.
- **Teste (três reproduções):** avulsa de 250; baixa manual com referência
  `E880AVULSA` (ou Plano B); `itau_pix_settle('E880AVULSA', …)` → `settled`, 2
  pagamentos (500), restituição pendente de 250. Itaú antes do extrato é recusado
  (`no_match`).
- **Correção:** no ramo da avulsa, review quando já houver baixa com o mesmo
  TXID ou endToEndId; no extrato de avulsa com cobrança Itaú, marcar a cobrança
  ou o recibo como baixados. Corrigir o `manual-financeiro.md` §4 ("baixados uma
  única vez").
- **Teste que fecha:** `itauPixCharges` e `planoBExtratoPix`.

### F-06 — Excluir B/L irmão de container compartilhado não corrige o vizinho

- **Evidência (Código):** `capture_invoice_basis` (`130`:436-438) busca a
  viagem em `bls`, já apagado na cascata; não há captura em DELETE de `bls`.
  Contraria a ADR 0078, item 11.
- **Teste:** T1 faturado em 250 com T2 no container; `delete_records('bl',
  ['T2'])` → T1 continua 250, cotação 500, sem alerta.
- **Correção:** incluir `OLD.voyage_id` no ramo de `bl_containers` ou capturar
  em BEFORE DELETE de `bls`.
- **Teste que fecha:** `deleteRecords`.

### F-07 — Demurrage: desconto revogado; o valor com desconto quita a Invoice

- **Evidência (Código):** `get_demurrage_recent_values` (`002`:7518, as duas
  fotos mais recentes de qualquer origem); `register_demurrage_payment`
  (`027`:223); `apply_demurrage_discount` (`306`).
- **Teste:** desconto de 50% (3.850), revogação (7.700),
  `register_demurrage_payment(…, 3850)` → `paid` por 3.850.
- **Correção:** a janela considera só fotos de PTAX mais a vigente, ou
  invalida as anteriores à última mudança de desconto.
- **Teste que fecha:** `demurrageMoney`.

### F-08 — Individual coberta pode ser cancelada, e o B/L é faturado de novo

- **Evidência (Código):** `cancel_invoice` barra só consolidada aberta
  (`241`:379-394); `_cancel_invoice_core` conta só os pagamentos da própria
  fatura (`126`:59) e recalcula `financial_status` só por `invoice_bls`
  (`126`:81-99); a tela oferece a ação (`InvoiceDetailModal.tsx`:141 e :688).
- **Teste:** consolidada de 1.200 paga; cancelar a individual coberta →
  `cancelled`, B/L `pending`; Emitir gera 600 e o Portal mostra 600.
- **Correção:** recusar o cancelamento de `covered` e de fatura cujos
  recebíveis tenham `ledger_settlements`; esconder o botão.
- **Teste que fecha:** `invoiceReissue`.

## Lote 2 — altos

| ID | Achado | Evidência | Teste (reprodução) | Correção | Teste que fecha |
|---|---|---|---|---|---|
| F-09 | Baixa Itaú para em silêncio | `itau-pix/index.ts`:73-96 responde 200 em falha; `rotina_http_falhou` só lê status (`310`, `316`:115); `itauPix.ts`:441-448 lança antes do checkpoint, `listPix` (:245) aplica fuso a terceiros, limite de 50 páginas (:249), janela de 6 h congela; SQLSTATE passageiro persistente relançado (`153`:255); jobs `itau-pix-queue` e `recalc-demurrage-ptax` fora de migration | Código + fetch falso; banco recriado sem os dois jobs | Resposta não-2xx em falha; alerta de checkpoint parado > 15 min; review do registro ruim e avanço; jobs por migration com o dispatcher | `itauPix.test.ts`, teste do handler, presença dos jobs |
| F-10 | Pix em análise fechado por outro pagamento (decisão 17) | `itau_pix_close_receipts_on_paid` (`154`:34-44) | Pix de 600 em análise + TED distinto de 600 → `handled`, sem restituição | Fechar só pela baixa com o mesmo endToEndId | `itauPixCharges` (o caso atual que asserta o fechamento muda) |
| F-11 | Pagar individual não reemite a consolidada (decisões 7 e 8) | `247`:785-830 só obsoleta; reemissão só para `cancelled` com `reissue_requested_at` (`128`:264, 345); obsoleta some do Portal (`298`:76); sucessora manual sem `replaces_invoice_id` | I1 paga → C1 obsoleta, nada emitido; QR antigo → review | Reemitir com os recebíveis restantes (padrão de `_try_recreate_consolidated`); `replaces_invoice_id`; notificação no Portal; obsoleta visível como "Substituída" | `consolidadaCruzada`, `portalConsolidadaPaga` |
| F-12 | Fatura cancelada deixa o vínculo `active` (decisão 12) | `bl_open_financial_reasons` (`191`:274) e `_void_unbilled_bl_receivables` (`179`:1569) contam vínculo de fatura cancelada; `_cancel_invoice_core` não marca | Cancelar fatura → `cancel_bl` recusado; Liberação emite de novo | Exigir fatura viva (como `bl_delete_lock_reasons`, `191`:148) ou obsoletar os vínculos; reprocessos não emitem B/L cuja fatura foi cancelada | `blCancel` com ledger |
| F-13 | `cancel_voyage` ignora o financeiro (decisão 14) | `178`:817-831; selo `200`:64, `216`:16 | Fatura `issued` com Pix ativo; baixa recusada "operação selada" | Recusar com fatura viva ou baixa; anular recebíveis sem fatura | `efeitosViagemCancelada` |
| F-14 | Aba Operação do Portal em dobro com consolidada aberta | `_portal_bl_local_charges` (`298`:410) | C1 com `total_brl 200` (100 + consolidada) | Regra da `344` | `portalInspectionParity` |
| F-15 | Dois documentos abertos para o mesmo recebível (decisão 9) | núcleo da consolidada não marca o B/L nem confere prontidão (`019`:880); `link_invoice_to_ledger` vira `consolidated` com vários B/Ls sem conferir (`002`:9864) | consolidada + duas individuais abertas; INV com A6 e A6+A4 | Restrição de um documento local aberto por recebível; consolidada interna marca o B/L e roda as checagens do Emitir | `financialBattery` |
| F-16 | Gate e checagens contornáveis pela API | `authenticated` com UPDATE em `bls.charge_status` e `billing_hold_reason` (policy `bls_update_active_global`); `create_invoice_from_bls_with_ledger` sem as gates 4 a 8; `create_invoice_from_bls` fora do ledger (`002`:27639) | UPDATE direto + RPC emite 100 omitindo linha de 500 | Retirar as colunas do UPDATE; gates no núcleo; revogar `create_invoice_from_bls` | `auditSecurityBoundaries`, `advisorFuncoesFechadas` |
| F-17 | Correção reemite pelo preço atual (decisão 4) | `apply_invoice_basis_changes` (`130`:356) cota com `_quote_bl_local_charges` (`136`:433) | THD 1.000 → 1.300; edição neutra reemite 2.000 | Cotar base antiga e nova com o preço da fatura | `invoiceBasisCorrection` |
| F-18 | COD em B/L coberto por consolidada paga falha | `002`:1918 exclui `covered`; RAISE em `002`:1954 | `ERROR: Nao foi encontrado snapshot` | Buscar pelo vínculo da consolidada | `invoicePostBillingSafety` |
| F-19 | COD a maior, pago, bloqueia o Desbloqueio de CE para sempre | `manual_review_required` em todo `cancel_and_reissue` (`002`:2008-2011); `299`:61; liquidação (`276`) não limpa | Sucessora paga → `paid=false` | Ignorar a flag com ajuste `settled` e sucessora quitada | `ceUnlockMatriz` |
| F-20 | Correção a maior em B/L pago mantém o CE apto (decisão 20) | `ce_unlock_private.item` (`299`) | `paid=true` com cotação 1.200 e recebido 600 | Bloquear com Fatura desatualizada ativa de valor maior | `ceUnlockMatriz` |
| F-21 | Demurrage com Pix em análise continua cobrada (decisão 17) | `_itau_pix_sync` (`153`:90) cria cobrança nova; `_demurrage_dunning_block_reason` (`313`:54) não olha `itau_pix_receipts` | Review e nova cobrança `pending_create`; Régua não bloqueia | Pausar Régua e QR novo | `reguaCobrancaDemurrage` |
| F-22 | Foto do desconto de Demurrage em UTC | `306`:138 usa `CURRENT_DATE` (a isenção usa São Paulo, `306`:39) | Sessão UTC às 23h de Brasília: valor com desconto recusado, cheio aceito | Data de São Paulo | `demurrageMoney` |

## Lote 3 — médios

| ID | Achado | Evidência | Correção (decisão) | Teste que fecha |
|---|---|---|---|---|
| F-23 | Saldo interno ignora a avulsa | `get_customer_pending_balances` (`070`:4-33) | Linha da avulsa (decisão 11) | `manualInvoice` |
| F-24 | Aba Financeiro e lista Taxas Locais somam consolidada e individuais; coberta mantém `balance_brl` | `FinanceiroTab.tsx`:153-157; `TaxasLocais.tsx`:74-79; `247`:759 | "Faturado em aberto" pela regra do Portal (decisão 10); zerar o saldo da coberta | teste de componente; `portalConsolidadaPaga` |
| F-25 | Mudança de Condição, ETA ou câmbio não recalcula B/L provisório; irmão de importação posterior não recalculado (a doc diz que sim) | sem gatilho; `002`:21796; loop `178`:643; `taxas-locais.md` (fase provisória) | Decisões 1 e 2; recálculo dos irmãos provisórios na importação | `auditoriaImportacaoBlContainer`, `recebivelNoVinculoDoCliente` |
| F-26 | B/L que fica isento mantém recebível aberto | `_impl_106` retorna antes do `sync` (`129`:483) | Anular no ramo de isenção | `thdImoOog` |
| F-27 | Desvincular Cliente: recebível fica com o antigo; em faturado cancela a fatura | `342`:88; `save_bl_review` com `customer_id=''` (`BlClienteSection.tsx`:277) | Decisão 13 | `recebivelNoVinculoDoCliente` |
| F-28 | B/L cancelado aceita cálculo e lançamento manual e reabre o recebível | `_impl_106` e `_add_manual` sem `cancelled_at` | Recusar; filtrar na Validação | `blCancel` |
| F-29 | Falha de cálculo no vínculo de Cliente engolida (ROE ausente, usuário inativo); planilha de CE recusa o arquivo inteiro por ROE ausente | `342`:73-76 só `audit_logs`; `288`:16-18 | Abrir `billing_calculation_blocked` (já existe; `347` o fecha na emissão) | `recebivelNoVinculoDoCliente` |
| F-30 | Cancelar e reativar deixa `calculated` sem linhas; nunca fatura | `179`:1617-1623; `reactivate_bl` (`089`:99) | Zerar `charge_status`; recalcular na reativação | `blCancel` |
| F-31 | Troca de CNPJ paga presa em `reissue_pending`; Fatura desatualizada não fecha após `completed` | `136`:125, `136`:103 | Tratar `already_invoiced` do Cliente-alvo como concluído; fechar o alerta em `_finish_invoice_customer_change`; decisão 15 | `invoicePostBillingSafety` |
| F-32 | `bb_cbm` sozinho muda a modalidade sem correção | gatilho `064`:275; `177`:383 | Capturar `bb_cbm`, `bb_packages_qty`, `bb_machine_qty` | `invoiceBasisCorrection` |
| F-33 | ETA alterada depois da emissão | sem captura em `voyages` | Fica como está (decisão 5); registrar no módulo | — |
| F-34 | Gate fechado depois da emissão impede cancelar baixa e corrigir | `enforce_portal_invoice_gate` (`097`:366) em toda volta a `issued` | Checar só nula ou rascunho → `issued` | `portalBillingRelease` |
| F-35 | Corrigir e-mail de recuperação abre o gate sem emitir as retidas | `portal_confirm_recovery_email` (`131`:53) | Reprocessar na reabertura do gate | `portalBillingRelease` |
| F-36 | Recibo de individual coberta omite pagamento direto | `_invoice_financial_summary` (`136`:58) | Somar os pagamentos diretos | `invoicePostBillingSafety` |
| F-37 | Devolução integral de avulsa parcial não suspende o Pix | `request_financial_refund` (`247`:1412-1436); `136`:395-397 | Decisão 19 | `invoicePostBillingSafety` |
| F-38 | Pix sem TXID descartado; Pix em duplicidade em fatura local quitada sem caminho | `itauPix.ts`:438; restituição excepcional só avulsa e Demurrage | Decisões 16 e 18 | `itauPixCharges` |
| F-39 | `portal_reprocessamento_falhou` só fecha com outro reprocessamento | ver "Já tratado na staging" | Fechar quando o B/L é faturado | `portalBillingRelease` |
| F-40 | Restituição de Demurrage pendente sem alerta | `_sync_refund_alert` só lê `invoice_refunds` (`130`) | Gatilho em `demurrage_refunds` | `invoicePostBillingSafety` |
| F-41 | COD com diferença zero cria ajuste pendente para sempre | `002`:2008 | Não criar ou liquidar na hora | `invoicePostBillingSafety` |
| F-42 | `*Migration.test.ts` caem em `migrations_archive` e passam sobre SQL histórico | `src/test/setup.ts`:43-70 | Contratos financeiros sobre o catálogo local-pg; listar os que testam SQL arquivado | — |

## Lote 4 — baixos e documentação

| ID | Achado e evidência | Correção |
|---|---|---|
| F-43 | Ano do número em UTC (decisão 21); `lpad(…,4)` colide a partir de 10.000 (`assign_invoice_number`, `002`:2424); lock de `invoice_counters` até o commit gera deadlock entre o lote e o Emitir | Ano de Brasília; 5 dígitos; tratar 40P01 como erro passageiro no lote |
| F-44 | Evento `obsolete` reinserido em consolidadas já obsoletas (`247`:812-830) | Inserir só para as do `RETURNING` |
| F-45 | Lista do Portal lê navio, Viagem e POD ao vivo (`298`:76) | Ler do snapshot |
| F-46 | Avulsa: Cliente desativado aceito (ADR 0073 item 6); linha USD com quantidade × unitário ≠ total; sem `invoice_lifecycle_events` de `cancelled`/`paid` | Recusar desativado; unitário coerente; eventos |
| F-47 | Cancelar baixa Itaú deixa o recibo `settled`; restituição de excedente apagada em cascata (FK `ON DELETE CASCADE`) | Recibo volta a review; cancelar em vez de apagar |
| F-48 | Baixa Itaú gravada como `pix_extract`; texto "A referência bancária continua protegida contra duplicação" (`InvoiceDetailModal.tsx`:233) falso; textos de alerta com ações removidas (`124`:140-141, `129`:434-436) | Origem própria; textos corretos |
| F-49 | Card Cliente da ficha do B/L lê `customers.pending_balance`, que ninguém atualiza (`BlClienteSection.tsx`:272) | Usar o saldo canônico |
| F-50 | Invalidações faltando: `useCancelInvoice`, recálculo, `INVOICE_BASIS_CACHE_KEYS`; saldo da sessão do Portal não atualiza depois da baixa Itaú (`usePortalBilling.ts`:160-190) | Incluir as chaves; reler a sessão |
| F-51 | `obsolete_consolidated_invoice` (`241`:713) aceita consolidada com pagamento; a guarda de `portal_obsolete_consolidation` (`109`:553) não vê o Itaú | Recusar com pagamento; olhar `itau_pix_receipts` |
| F-52 | Reprocessamento da ativação grava `issued_by` = primeiro Administrativo ativo (`083`:803) | Ator de sistema identificado |
| F-53 | Ver "Já tratado na staging" | Restringir `upsert_billing_alert`; justificativa mínima em `resolve_stale_invoice` |
| F-54 | Painel do Portal mostra US$ bruto ao lado do R$ líquido do desconto (`PortalDashboard.tsx`:48); recálculo sobrescreve ROE manual do B/L | Mostrar o líquido; decidir o ROE manual |
| F-55 | IMO+OOG sem item THD standard não é cobrado nem sinalizado (só Código, `248`) | Sinalizar como revisão |
| F-56 | Documentação divergente: `manual-financeiro.md` §6 e §7 contra ADR 0085 D2; `taxas-locais.md` (irmãos na fase provisória); `faturamento.md` cita `createInvoiceFromBls` como chamador e migrations antigas no catálogo | Corrigir junto da tarefa de cada módulo |

## O que não foi verificado

- Produção: INV-2026-0016 a 0035, dados da Vettore, jobs 25 e 26 do `pg_cron`,
  fuso do banco remoto.
- Itaú real (cancelamento da COB, recusa de QR cancelado, atraso do `GET /pix`)
  e as Edge Functions em execução.
- Supabase Auth e PostgREST reais e as telas no navegador (papéis simulados com
  `SET ROLE`; totais de tela pelas funções TS aplicadas às linhas das RPCs).
- Mesmo TXID entre Taxas Locais e Demurrage; pagamento e correção simultâneos;
  queda de rede no commit; volume grande.
- Ramo "só sincroniza" da `342`; reimportação real de B/L cancelado; efeitos
  órfãos em `import_pending_effects` depois da exclusão.

## Anexo — matrizes do comportamento observado

Estado do código na `main` em `806d2b5`, antes de qualquer correção deste
plano (Código e Teste, como nos achados). A coluna "Deveria?" da primeira
matriz já aplica as decisões da ADR 0093; "?" virou decisão onde indicado.
"Área 9" quer dizer o caminho da ADR 0077: reemite sem pagamento, abate e
restitui com valor menor, ou abre Fatura desatualizada com valor maior.

### Evento × recálculo

| Evento | Recalcula hoje? | Onde | Deveria? | Efeito no recebível e na fatura |
|---|---|---|---|---|
| Importação de B/L novo | sim | loop de `import_bl_freight_with_metadata_legacy_189` (corpo `178`:541, linhas 643-680) | sim; vincula a tabela (decisão 1) | recebível nasce se há Cliente; falha vai a `audit_logs` e `provisional_charges` |
| Reimportação, não faturado, sem override | sim: dados antigos, preço e rateio atuais | `178`:643; trava `213`:43 | sim, com a tabela vinculada | recebível muda; hoje preço novo entra |
| Reimportação, não faturado, com override | sim | idem e `213`:1150 | sim | recebível muda |
| Reimportação, faturado | não (pula); com override, área 9 | `process_invoice_basis_changes` (`130`:174) | sim | área 9 |
| Irmão de container em importação posterior | **não** | `178`:667 só enfileira em falha | sim (ADR 0038, decisão 8) | provisório velho; faturado: área 9; retido sai errado (F-01) |
| Efeito `local_charges` | parcial: irmãos sem CE e sem retenção | `178`:159 | incluir retidos e com CE (decisão 3) | — |
| Edição na ficha, não faturado | **não**; `charge_status` não muda | `save_bl_review` (`177`:346, `271`:23) | sim, a base (decisão 3) | o reuso emite o valor velho (F-02) |
| Edição na ficha, faturado | sim (área 9), salvo `bb_cbm` sozinho | `capture_invoice_basis` (`130`:414) | sim | área 9; `bb_cbm` não dispara (F-32) |
| Container: lacre, tara, peso, tipo | não | `292`:19 | não (o motor não lê) | nada |
| Perfil e SOC/COC | sim | `205`:27, `205`:163 | sim | faturado: área 9 |
| Veículos | sim | `_vehicle_charges_follow` (`184`:22) | sim | anula o recebível se isento; faturado: área 9 |
| Cliente NULL → Y | sim | gatilho `342`:47/84 | sim | recebível nasce com a Condição; falha só em `audit_logs` (F-29) |
| Cliente X → Y, não faturado | sim, pela Condição de Y | `342`; `relink_bl_customer` (`136`:575) | sim | recebível passa a Y |
| Cliente X → Y, faturado | área 9 | `136`:562; `_finish_invoice_customer_change` (`136`:103) | sim | reemite, ou devolve e reemite |
| Cliente X → NULL | **não** | `342`:88 (WHEN) | anular (decisão 13) | recebível fica com X; faturado: fatura cancelada (F-27) |
| CE cadastrado pela planilha | sim, no registro | `288` (ramo diferido) | sim | emissão em lote reaproveita |
| CE cadastrado pelo servidor | sim | `_auto_bill_bl_core(reuse=false)` (`181`) | sim | emite com o valor atual |
| CE alterado ou removido | não | WHEN da `288`; `remove_bl_ce_mercante` | não (ADR 0078, item 4) | fatura intacta |
| Lote, Retomar, Liberação, ativação, `local_billing`, Emitir | **não** (reuse) | `212`:98-113; `085`:559-560; `178`:159; `241`:617 | base sim, preço do dia do CE (decisão 3) | valor e rateio do dia do CE (F-01, F-02) |
| Planilha de datas de container | não | `333`:51 | não | só Demurrage |
| Baplie | sim, nos não faturados | `194`:1451 e legacy_189 | sim | faturado: área 9 |
| COD | sim, no não faturado | `apply_cod_financial_effect` (`249`:69) | sim | faturado: Ajuste de COD e área 9 |
| Modo de carga | marca `not_calculated` | `_recalculate_bl_cargo_mode` (`064`:114) | sim; revincula a tabela do escopo novo (decisão 1) | recebível velho até o próximo cálculo |
| Tabela nova ativada | **não** | sem gatilho | não: vale para B/L novo (decisão 1) | — |
| Edição de item ou Condição | **não** | sem gatilho | sim: correção (decisão 2) | hoje provisório velho; faturado reprecifica no próximo evento (F-17) |
| Câmbio | não | só auditoria | não | provisório com ROE velho; faturado congelado |
| Viagem, escala ou ETA | **não** | `trg_voyage_schedule_snapshot` (`002`:21796) | provisório sim; faturado não (decisão 5) | Condição velha |
| Cancelar B/L | anula o próprio; irmão faturado: área 9 | `cancel_bl` (`179`:1586) | sim, também irmão retido | irmão retido sai com 50% (F-01) |
| Excluir B/L | anula o próprio; **vizinho não** | cascata (`130`:436) | sim (ADR 0078, item 11) | sub-cobrança (F-06) |
| Reativar B/L | **não** | `reactivate_bl` (`089`:99) | sim | `calculated` com 0 linhas (F-30) |
| Cancelar Viagem | não; sela | `cancel_voyage` (`178`:817) | recusar com fatura viva; anular sem fatura (decisão 14) | fatura e recebível congelados (F-13) |
| Lançamento manual | sincroniza se há recebível | gatilho `061`:78 | sim | aceita B/L cancelado e isento (F-26, F-28) |

### Evento × efeito financeiro

Colunas: **Fatura**, **Cons.** (consolidada), **Receb.** (recebível),
**Baixa**, **Vela** (saldo interno), **Portal** (saldo do Portal), **Pix**,
**Rest.** (restituição), **Alerta**.

| Evento | Fatura | Cons. | Receb. | Baixa | Vela | Portal | Pix | Rest. | Alerta |
|---|---|---|---|---|---|---|---|---|---|
| Importar ou calcular (sem fatura) | — | — | open | — | entra | não entra | — | — | falha: só `audit_logs` |
| Emitir (manual, lote ou CE) | issued, snapshot | — | vínculo active | — | igual | entra (com CE) | cobrança criada | — | fecha `billing_auto_issue_failed` |
| Gate fechado no CE | retida | — | open | — | entra | não | — | — | — |
| Liberação ou Portal ativado | emite as retidas 1 vez, com o cálculo do CE | — | vínculo | — | igual | entra | criado | — | falha: `portal_reprocessamento_falhou` |
| Corrigir e-mail de recuperação | não emite (F-35) | — | — | — | — | — | — | — | — |
| Criar consolidada | issued | vínculos active | — | — | igual | substitui as individuais (`344`) | QR da consolidada; os das individuais continuam | — | — |
| Pagar individual inteira dentro de consolidada | paid | obsolete, sem reemissão | settled | sim | cai | cai | cobrança da consolidada `pending_cancel` | — | — |
| Pagar individual em parte dentro de consolidada | partially_paid | sem mudança: total e QR antigos | parcial | sim | cai | lista cai, detalhe não | QR antigo da consolidada | se o QR antigo for pago | — |
| Pagar consolidada inteira | paid | — | settled | sim | 0 | 0 | individuais cancelados | se manual a maior | — |
| Pagar consolidada em parte | partially_paid | — | parcial | sim | cai | cai | individuais com QR cheio | — | — |
| Cancelar baixa da individual | issued | todas as obsoletas revivem | reabre | removida | sobe | dobra | novas cobranças com valor antigo | excedente apagado em cascata | — |
| Pix Itaú exato | paid | conforme o caso | settled | sim | cai | cai | concluded | — | — |
| Pix divergente ou de fatura cancelada | intacta | — | — | não | — | — | concluded | — | `pix_unreconciled` |
| Pix em análise e baixa distinta | paid | — | — | 1 | — | — | — | não | fecha sozinho (F-10) |
| Avulsa baixada pelo extrato e depois pelo Itaú | paid, pago 2× | — | — | 2 | não conta | 0 | concluded | falsa | Restituição pendente |
| Cancelar fatura aberta | cancelled | — | open; vínculo segue active | — | conta | sai | `pending_cancel` | — | — |
| Cancelar individual coberta | aceito | intacta | settled | — | igual | reemissão cobra de novo | — | — | — |
| Cancelar consolidada aberta | cancelled | — | vínculos active | — | igual | individuais voltam | cancelado | — | — |
| Cancelar B/L sem fatura | — | — | void | — | sai | — | — | — | — |
| Cancelar B/L pago | paid, correção de 100% | — | settled | mantida | 0 | 0 | cancelado | integral | Restituição pendente |
| Excluir irmão de container | vizinho intacto | — | void | — | — | — | — | — | nenhum |
| Cancelar Viagem | issued | — | open, selado | recusada | conta | conta | ativo | — | nenhum |
| Correção sem pagamento | cancela e sucessora | recriada 1 vez | novo valor | — | novo | novo | trocado | — | — |
| Correção paga, valor menor | total mantido | só o B/L | correção | mantida | ajusta | ajusta | saldo novo | excedente | Restituição pendente |
| Correção paga, valor maior | intacta | intacta | intacto | — | antigo | antigo | antigo | — | Fatura desatualizada; CE continua apto (F-20) |
| Troca de Cliente paga | original paid | só o B/L | arquivado; novo depois da devolução | preservada | 0, depois B | 0, depois B | cancelado, depois novo | o recebido | Fatura desatualizada não fecha |
| Solicitar restituição excepcional | intacta | — | — | — | — | — | ativo se parcial (F-37) | pending | abre |
| Confirmar restituição | avulsa com cancelamento total: cancelled | — | — | — | — | — | — | settled | fecha ao zerar |
| COD não faturado | — | — | recalcula | — | novo | — | — | — | — |
| COD faturado sem pagamento | reemite | aberta: reemite | novo | — | novo | novo | novo | — | CE bloqueado para sempre se o valor subiu (F-19) |
| COD em individual coberta | erro, nada gravado (F-18) | — | — | — | — | — | — | — | nenhum |
| Emitir Demurrage | issued | — | — | — | entra | entra (com CE) | criado | — | falha: `import_effect_blocked` |
| Recálculo PTAX | `current_*` em issued sem pagamento | — | — | — | atualiza | atualiza | `pending_update` | — | `demurrage_ptax_recalc_failed` |
| Desconto e depois revogação | volta ao cheio | — | — | aceita o valor com desconto (F-07) | — | — | — | — | — |
| Pix de Demurrage em análise | issued | — | — | — | conta | conta | nova cobrança | — | `pix_unreconciled`; Régua continua (F-21) |
| Datas alteradas, sem pagamento | cancela e reemite | — | — | — | novo | novo | trocado | — | `demurrage_invoice_dates_changed` (fecha desde a `349`) |
| Efeito de importação repetido | `existing` / `already_invoiced` | — | — | — | — | — | — | — | — |

## Ao concluir

Mover este plano para `docs/archive/plans/`, retirar a linha de
[`README.md`](README.md), atualizar o índice de ADRs (implementação da 0093) e
registrar a entrega no [CHANGELOG](../CHANGELOG.md).
