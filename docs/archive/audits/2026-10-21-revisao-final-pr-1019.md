# Revisão final da PR 1019 — 2026-10-21

Revisão independente feita em 2026-10-21 sobre o diff `origin/staging...HEAD`
do branch `claude/eager-noether-vuddpw` (base `99e783c`, head `6ea81ff`,
migrations `354` a `384`), antes do merge da PR luccafwlog/vela#1019. É
registro histórico: as regras vivas estão nos módulos citados e nas
[ADR 0093](../../adr/0093-tabela-vinculada-ao-bl-e-coerencia-financeira.md) e
[ADR 0094](../../adr/0094-preco-fixo-na-importacao.md).

## Como foi feita

Quatro revisores independentes, só leitura, um por área: preço e cálculo das
Taxas Locais; faturamento; Pix, Demurrage, avulsa e Portal; segurança, grants e
documentação. Cada achado foi conferido no código e no Postgres 16 local antes
de entrar na correção. As correções estão na migration `385`, no front e nos
documentos citados; cada uma tem caso em
`src/integration/revisaoFinalFrenteFinanceira.local-pg.test.ts` (ou na suíte
indicada), que falha sem a `385`.

## Achados e destino

| Achado | Estado | Entrega |
|---|---|---|
| COD de B/L faturado convertia o dólar pelo câmbio do dia, não pelo fixado; o ramo não faturado com linha manual ignorava as linhas em dólar | corrigido | `385` item 1 |
| Consolidada cancelada (ou obsoleta sem sucessora) deixava "faturado" o B/L que ela faturava sem individual, e o Emitir o recusava | corrigido | `385` item 2 |
| Cancelar a baixa de consolidada já substituída a reabria como emitida, com saldo e QR | corrigido | `385` item 5 |
| Avulsa reemitida na troca de CNPJ herdava data, autor e motivo do cancelamento | corrigido | `385` item 6; `vinculoDoClienteNoBl` |
| Pix baixado pelo extrato (plano B) e relido pela consulta Itaú virava duplicidade com restituição pendente falsa | corrigido | `385` item 7 |
| Falha de consulta Itaú (`itau_pix_receipt_failures`) não fechava quando o mesmo Pix era baixado | corrigido | `385` item 7 |
| Invoice de Demurrage com ROE manual abria o alerta diário da PTAX e não tinha o QR estendido; com Pix em análise tratado, ficava sem QR | corrigido | `385` item 8 |
| "Pix recebido sem baixa" (sem TXID) não fechava pela baixa manual; a baixa que já nasce com a referência não fechava nenhum Pix em análise | corrigido | `385` itens 9 e 10 |
| QR estático da avulsa remontado cobrava o total, não o saldo | corrigido | `385` item 11 |
| Tirar ROE manual gravava o histórico no dia do clique e recusava Invoice vencida; o detalhe dizia "fora do recálculo" em Invoice cancelada | corrigido | `385` item 12; `ManualRoeRelease.tsx`, `DemurrageInvoiceDetailModal.tsx` |
| Texto do Pix sem TXID dizia "sem TXID do Vela" | corrigido | `385` item 13 |
| Falha de consulta (com o Pix inteiro) lida por qualquer Departamento | corrigido | `385` item 14 |
| Erro ao gravar Pix sem TXID travava a consulta Itaú para sempre | corrigido | `supabase/functions/_shared/itauPix.ts`; `itauPix.test.ts` |
| "Mover veículos" tirava chassi de B/L cancelado; a marca de exclusão valia até o fim da transação | corrigido | `385` item 15 |
| `refix_bl_local_charge_prices` aberta a qualquer Departamento pela API, sem tela | corrigido | `385` item 16 |
| Falha de cálculo não recusava o CE da ficha em B/L com Cliente, a reativação do B/L nem a aprovação da conciliação | corrigido | `385` item 17 |
| Lançamento manual ignorava a tabela vinculada desativada e o preço fixado | corrigido | `385` item 18 |
| Renomear o item reprecificava os B/Ls | corrigido | `385` item 19 |
| Corrigir uma Condição alcançava B/L importado antes dela | corrigido | `385` item 20 (`bl_price_freeze_items.override_id`) |
| Backfill da `378` não forçava o recálculo do B/L não faturado | corrigido | `385` item 21 |
| `reverse_invoice_payment` voltava o papel a `authenticated` fixo | corrigido | `385` item 22 |
| `charge_table_in_use` e `bl_calculation_is_current` SECURITY DEFINER sem guarda na API | corrigido | `384` |
| Escrita direta e RPCs revogadas ainda descritas como abertas em `RASTREABILIDADE.md`; textos de "preço do dia do CE" e "ROE do dia"; ADR 0038 sem faixa; 384 sem registro | corrigido | documentos citados no CHANGELOG |
| `updateVaziosBooking` sem chamador gravava direto em `vazios_bookings` | corrigido | removida |
| Prévia da carga solta não mostrava o total de volumes mudado sozinho; ficha do Cliente misturava os dois recortes do saldo | corrigido | `breakbulkImport.ts`, `VisaoGeralTab.tsx` |
| Correção que não reemitiria (nova fatura retida pelo Portal ou com valor a revisar) cancela e deixa Reemissão pendente | decisão pendente | regra da migration `126` mantida; o texto da tela passou a dizer isso |
| Manifesto BB que acrescenta carga solta a B/L de container faturado, sem a confirmação | decisão pendente | regra da PR 698 mantida (reabre a Revisão) |
| Condição criada depois da importação, com vigência retroativa, no vínculo do Cliente | decisão pendente | segue valendo pela vigência (`freeze_follows_bl_customer`) |
| B/L sem Cliente importado sem câmbio configurado | decisão pendente | aceito; o câmbio entra no primeiro cálculo que o tem (documentado) |
| Pix do QR de consolidada substituída sem sucessora aberta; Pix do QR antigo de avulsa em cancelamento com devolução integral | decisão pendente | vão para análise |
| Confirmação da carga solta não amarrada ao valor da prévia; prévia não simula a Troca de Consignatário; deadlock entre baixas cruzadas; corrida entre refixar e cálculo | não corrigido (melhoria ou suspeita sem reprodução) | ver a resposta da revisão na PR |
