# 0077 — Fatura emitida não muda de valor

Status: aceito — 2026-10-01. Implementação local nas migrations `122` a `126`; deploy remoto não verificado.

## Contexto

A fatura de Taxas Locais aparece no Portal na emissão. Corrigir o B/L ou cobrar
um serviço depois disso não pode alterar o documento que o Cliente já recebeu.
A edição de itens manuais em fatura emitida contradizia o congelamento da
[ADR 0038](0038-taxa-local-valor-congelado-ancorado-na-escala.md).

## Decisão

1. Fatura emitida preserva total e itens. Nenhum fluxo vigente cria rascunho;
   as duas RPCs antigas de edição de itens perdem `EXECUTE` para a API.
2. Fatura local sem pagamento, individual ou consolidada: **Cancelar e
   reemitir**, com motivo e B/Ls afetados. A emissão sucessora aponta para a
   cancelada; **Reemissão pendente** acompanha o intervalo para corrigir o B/L.
   Não há vencimento a herdar. Com qualquer pagamento, esse caminho é recusado.
   Individual cujo B/L está numa consolidada aberta reemite pela consolidada,
   marcando o B/L a corrigir. Fatura com correção registrada não é cancelada,
   mesmo depois de cancelar a baixa (migration `125`).
   **Reemissão automática** (decisão do dono, 2026-10-01; migration `126`):
   reimportação do B/L com override ou flags do Baplie que alteram a base
   faturada de um B/L sem pagamento cancelam a individual e a consolidada que
   o incluem e as reemitem com o valor recalculado, pelo mesmo núcleo da
   emissão automática do CE e com as mesmas travas. Se uma trava impedir a
   emissão, as faturas ficam em Reemissão pendente e o alerta diz o motivo.
   O Cancelar e reemitir manual continua para correções fora desses fluxos.
3. Serviço eventual é decisão do operador. Pode acompanhar a reemissão sem
   pagamento ou gerar avulsa; com pagamento, só avulsa. **Tipo de cobrança**
   resolve itens `manual_only` da tabela do B/L e a Condição do Cliente.
   B/L é obrigatório para item da tabela; **Outra** mantém nome, valor e
   contexto opcional. Quantidade por B/L é 1; por TEU deriva dos containers,
   recusando tipos desconhecidos. USD converte pelo ROE vigente na emissão,
   congelado no snapshot. O navegador não define o preço do item da tabela.
4. Correção que reduz a cobrança após pagamento usa **Correção após pagamento**:
   informe o total correto do B/L e motivo. O sistema calcula a diferença,
   abate primeiro o saldo aberto e registra restituição apenas do restante.
   Decisão complementar autorizada pelo dono nesta execução. O total original
   e o histórico de dinheiro recebido permanecem intactos.
5. A correção é registrada por recebível/B/L, inclusive em consolidada. Mantém
   trilha de redução, abatimento e restituição; pagamentos seguintes e Portal
   usam o saldo ajustado. A restituição não excede os pagamentos menos
   restituições não canceladas e segue `settle_invoice_refund`.
6. O operador vê uma prévia antes de confirmar: cobrança vigente, recebido,
   redução, abatimento, restituição e saldo restante. Registrar pagamento
   também confirma dinheiro recebido e avisa que pagamento parcial impede
   cancelamento/reemissão. Cancelar baixa não serve para corrigir preços. A baixa
   que financia restituição não pode ser desfeita se o restante recebido não
   cobrir a devolução comprometida; sem restituição, a reversão preserva o abatimento.
7. Mudanças efetivas na base faturada de fatura com pagamento, ou reemissão
   automática bloqueada, geram **Fatura desatualizada**, com orientação e
   acesso à fatura. Reimportação compara snapshots reais antes e
   depois, evitando alerta por substituição idêntica dos filhos. Baplie segue
   o mesmo produtor. Reemissão resolve automaticamente; avulsa/correção exige
   resolução manual justificada. O recebível emitido permanece congelado nos
   recálculos indiretos até cancelamento ou correção registrada.

## Relações e limites

Estende a [ADR 0075](0075-fatura-avulsa-flexivel.md) e preserva o congelamento
na emissão da 0038. Não altera Demurrage, Granito ou o ajuste de COD da
[ADR 0051](0051-cod-reprecifica-no-destino-final.md). A ativação da API Itaú
(PR #827) permanece fora do escopo; antes de combiná-la com reemissão, verificar
que o cancelamento da COB anterior foi confirmado. Este checkout usa Pix estático.

## Evidência

Código: `InvoiceDetailModal`, `InvoiceCorrectionPanel`, `ManualInvoiceModal`,
`PortalInvoiceDetailModal`, migrations `122`–`126`.
Testes: `invoiceCorrection.local-pg.test.ts`, `invoiceReissue.local-pg.test.ts`,
`InvoiceCorrectionPanel.test.tsx`, `ManualInvoiceModal.test.tsx`.
Postgres local usa shims; não comprova Auth/API nem rollout remoto.
