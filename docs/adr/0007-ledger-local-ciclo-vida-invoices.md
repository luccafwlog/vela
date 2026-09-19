# 0007 — Ledger local e ciclo de vida de invoices

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Ledger permanece; due_date e overdue foram retirados do ciclo das invoices locais.
> Rastreabilidade: [ADR 0055](./0055-taxa-local-sem-vencimento-praticado.md); [migration ativa 002](../../supabase/migrations/002_business_logic_and_security.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-06-09

## Contexto

Taxas locais precisam suportar B/Ls individuais, faturas consolidadas, reemissão, obsolescência, pagamentos parciais, conciliação PIX, portal do cliente e relatórios de saldo. Somente vincular B/Ls diretamente a `invoices` não preserva bem saldo, histórico e reemissão de consolidadas.

Granito usa o mesmo documento `invoices`, enquanto Demurrage tem fluxo e tabela própria.

## Decisão

Usar o ledger local como fonte de saldo para taxas locais e manter a emissão financeira em RPCs transacionais.

- `bl_receivables` representa recebíveis de taxas locais por B/L.
- `invoice_receivable_links` vincula recebíveis a invoices consolidadas ou individuais baseadas em ledger.
- `ledger_settlements` registra baixa/pagamento contra recebíveis.
- `invoice_lifecycle_events` registra eventos relevantes do ciclo de vida.
- `invoices` permanece como documento financeiro para taxas locais individuais, consolidadas e Granito.
- `invoice_bls` preserva o vínculo direto usado por invoices individuais/Granito.
- RPCs como `create_invoice_from_bls`, `create_local_consolidated_invoice`, `link_invoice_to_ledger`, `register_ledger_invoice_payment` e `reconcile_invoice_payment_by_txid` executam mudanças financeiras críticas de forma atômica.
- O payload PIX deve ser persistido quando a fatura é emitida ou consolidada; falhas em ledger ou persistência PIX não devem ser reportadas como sucesso silencioso.

## Consequências

- **Positivas**: saldos locais ficam reconstituíveis; consolidadas podem ser obsoletadas e refeitas com rastreabilidade; o Portal do Cliente consulta uma fonte coerente de aberto/pago.
- **Negativas / custos**: a UI precisa entender duas famílias de vínculo (`invoice_bls` e `invoice_receivable_links`); detalhes de consolidada podem exigir RPC dedicada para breakdown de itens sob RLS.
- **Interação com ADRs existentes**: a autonomia do cliente para refazer consolidada está documentada em `0002-portal-self-service-reconsolidation.md`.
