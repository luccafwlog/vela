# 0015 — Demurrage: conciliação por txid + janela das duas PTAX na data do pagamento

> **Situação atual (2026-10-13).** Continuam valendo a janela das duas PTAX na data do pagamento, a tolerância de R$ 0,01 e a quitação só integral.
> Desde 2026-10-07 a produção usa a cobrança PIX dinâmica do Itaú (migrations `151` a `154` e `219`): cada Invoice de Demurrage tem cobrança com TXID próprio (`VELA…`), atualizada a cada PTAX e baixada sozinha pela mesma janela. O QR estático e o `txid = doc_number` ficam para o provedor `static`, e a conciliação por extrato é plano B.
> Nenhuma ADR registra a integração Itaú; o registro é decisão pendente.
> Regra vigente em [Reconciliação PIX](../modules/reconciliacao-pix.md), seção "Fluxos e invariantes".

Status: aceito — 2026-06-24

## Contexto

Sob recálculo diário (ver 0014), o QR Code PIX é um BR Code **estático** com o valor embutido,
regenerado quando a PTAX muda. Regenerar não invalida os códigos antigos (PIX estático não expira),
então o cliente pode pagar com um QR de um dia anterior, e o valor recebido pode não ser o
`current_total_brl` do dia.

O sistema interno antigo (`demurrage-manager`) mostra o caminho de identificação correto: a
conciliação casa primeiro por **`txid == doc_number`** (o identificador embutido no QR), sem sequer
checar o valor; só no fallback compara o valor congelado por CNPJ. Esse `txid` identifica a fatura
sem ambiguidade **mesmo com valor flutuante**, porque o `doc_number` não muda no recálculo (só o
campo de valor do QR muda).

Para o valor, foram consideradas três estratégias:
1. **Valor único na data** — rígido demais (falso negativo intra-dia).
2. **Qualquer valor histórico** — permissivo demais (aceitaria PTAX muito antiga).
3. **Janela das duas PTAX mais recentes** — equilíbrio escolhido.

## Decisão

A conciliação de um pagamento de Demurrage:

- **Identifica a fatura por `txid = doc_number`** (normalizado) como caminho primário.
- **Valida o valor pago** contra as **duas entradas de recálculo mais recentes** em
  `demurrage_invoice_history` com `event_date <= data_do_pagamento` (tolerância R$ 0,01). Casar com
  qualquer um dos dois valores → pagamento válido.
- A janela é **ancorada na data do pagamento do extrato**, nunca na data em que o time financeiro
  executa a conciliação (que pode atrasar). "Imediatamente anterior" = a entrada de recálculo
  anterior por divulgação; pegar as duas mais recentes `<= data_do_pagamento` pula naturalmente
  fins de semana/feriados (não há linha sem mudança de PTAX).
- Fallback (txid ausente/ilegível no extrato): CNPJ + a mesma janela das duas PTAX.
- Um valor que não case com nenhuma das duas é tratado como **divergência** (manual). **Somente
  quitação integral** — não há pagamento parcial em Demurrage.
- O valor casado é congelado no histórico com `source='payment'`, `paid_at` recebe a data do
  pagamento e o recálculo daquela invoice é encerrado.

A função de apoio `get_demurrage_recent_values(invoice_id, payment_date)` devolve as duas entradas
mais recentes `<= payment_date`, substituindo a ideia de `get_demurrage_value_on_date` (um valor).

## Consequências

- **Positivas:** identificação inequívoca por txid mesmo com valor flutuante; tolera o atraso da
  conciliação e o pagamento com QR de até uma PTAX anterior, sem aceitar valores defasados; reúne o
  melhor do sistema antigo (txid) e do desenho novo (janela das duas PTAX); não exige QR dinâmico.
- **Negativas / custos:** depende do histórico imutável (0014) e da foto inicial na emissão; exige
  a função de janela e a reescrita da RPC de conciliação (`confirm_demurrage_pix_matches`).
- **Relação:** depende de 0014.
