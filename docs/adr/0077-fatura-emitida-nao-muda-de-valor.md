# 0077 — Fatura emitida não muda de valor

Status: aceito — 2026-10-01, revisado em 2026-10-02 (decisões do dono).
Implementação local nas migrations `122` a `130`; deploy remoto não verificado.

## Contexto

A fatura de Taxas Locais aparece no Portal na emissão. Corrigir o B/L ou cobrar
um serviço depois disso não pode alterar o documento que o Cliente já recebeu.
A edição de itens manuais em fatura emitida contradizia o congelamento da
[ADR 0038](0038-taxa-local-valor-congelado-ancorado-na-escala.md).

## Decisão

1. Fatura emitida preserva total e itens. Nenhum fluxo vigente cria rascunho;
   as RPCs antigas de edição de itens perdem `EXECUTE` para a API.
2. **A correção do B/L é sempre automática.** Não há botão para cancelar e
   reemitir nem para digitar um valor corrigido. O operador corrige o B/L —
   reimportação com override, Baplie ou alteração direta no B/L, nos
   containers ou nos veículos — e o sistema trata a fatura no fim da mesma
   transação (migration `128`).
   - A comparação usa só o que o motor de taxas lê: viagem, POD, modo de carga,
     Cliente, pesos, movimentação, containers (IMO, OOG, SOC/COC) e veículos.
     Uma data de Demurrage, por exemplo, não é correção.
   - Só há efeito se o valor do B/L mudar (calculado com o ROE em que foi
     faturado) ou se o Cliente mudar.
3. **Sem pagamento:** a individual e a consolidada que cobram o B/L são
   canceladas e reemitidas. A reemissão usa o ROE do dia: reemitir inclui
   deixar o câmbio flutuar. A sucessora aponta para a cancelada
   (`replaces_invoice_id`). Vários B/Ls da mesma consolidada corrigidos juntos
   geram uma única nova consolidada.
   - A consolidada só volta **com os mesmos B/Ls**. Se algum B/L foi cancelado,
     ficou isento, foi quitado pela individual ou passou para outro Cliente, ela
     é encerrada sem reemissão, com o motivo registrado; os demais B/Ls seguem
     cobrados pelas individuais deles.
   - Se uma trava barrar a emissão (Portal não pronto, linha que precisa de
     revisão), a fatura fica em **Reemissão pendente** e o alerta **Fatura
     desatualizada** diz o motivo. Resolvida a trava, o Administrativo usa
     **Emitir fatura** na ficha do B/L; a consolidada volta sozinha quando as
     individuais saírem, ou por **Tentar reemitir**. B/L cancelado ou isento
     encerra a pendência.
4. **Com pagamento (parcial ou integral), a fatura não é reemitida:**
   - valor menor: o sistema abate primeiro o saldo aberto; o que passar dele vira
     restituição e abre o alerta **Restituição pendente**, que fecha quando o
     Administrativo confirma a restituição;
   - valor maior: alerta Fatura desatualizada; a diferença vai em fatura avulsa;
   - troca de Cliente ou novo cálculo com revisão pendente: alerta Fatura
     desatualizada.
   O total original e o dinheiro recebido permanecem intactos; pagamentos
   seguintes e o Portal usam o saldo ajustado. A baixa que financia restituição
   não pode ser desfeita, e fatura com ajuste registrado não é cancelada.
5. **Erro de preço** (tabela ou Condição do Cliente errada) não reemite: a
   correção do preço vale para faturas futuras; a já emitida fica como está, e a
   diferença segue por restituição ou avulsa.
6. Serviço eventual é decisão do operador e usa avulsa. **Tipo de cobrança**
   resolve itens `manual_only` da tabela do B/L e a Condição do Cliente; B/L é
   obrigatório para item da tabela; **Outra** mantém nome, valor e contexto
   opcional. Quantidade por TEU deriva dos containers. USD converte pelo ROE
   vigente na emissão. O navegador não define o preço do item da tabela.
7. A ficha do B/L perde **Marcar revisado** e **Pronto para faturar**
   (migration `127`): a confirmação do cálculo é o CE Mercante. **Emitir
   fatura** (Administrativo, com confirmação) cobre só a emissão que o
   automático não fez. Sem Marcar revisado, o container IMO e OOG ao mesmo
   tempo deixou de travar o cálculo: paga o THD normal com 150% de majoração
   (× 2,5), derivado do THD normal da tabela ou da Condição do Cliente
   (migration `129`).
8. **Portal:** a fatura cancelada continua acessível ao Cliente, que já a viu,
   mas não aparece por padrão; só pelo filtro **Cancelada**.

## Histórico desta decisão

Na versão de 2026-10-01 (migrations `122`–`126`) havia **Cancelar e reemitir**
manual no detalhe da fatura e **Correção após pagamento** com o total digitado.
O dono decidiu em 2026-10-02 que a correção nasce sempre do B/L e é
automatizada ao máximo; a `128` remove as duas RPCs
(`cancel_invoice_for_reissue`, `register_invoice_correction`) e os gatilhos da
`124` que alertavam a cada alteração de container.

## Relações e limites

Estende a [ADR 0075](0075-fatura-avulsa-flexivel.md) e preserva o congelamento
na emissão da 0038. Não altera Demurrage, Granito ou o ajuste de COD da
[ADR 0051](0051-cod-reprecifica-no-destino-final.md). A ativação da API Itaú
(PR #827) permanece fora do escopo; antes de combiná-la com reemissão, verificar
que o cancelamento da COB anterior foi confirmado. Este checkout usa Pix estático.

Limite conhecido: o rateio de container compartilhado entre B/Ls da mesma
viagem não é reavaliado no B/L vizinho quando só um deles é corrigido.

## Evidência

Código: `InvoiceDetailModal`, `InvoiceCorrectionPanel`, `PendingReissuesPanel`,
`ManualInvoiceModal`, `PortalInvoiceDetailModal`, migrations `122`–`129`.
Testes: `thdImoOog.local-pg.test.ts`, `invoiceBasisCorrection.local-pg.test.ts`,
`invoiceAutoReissue.local-pg.test.ts`, `invoiceCorrection.local-pg.test.ts`,
`invoiceReissue.local-pg.test.ts`, `InvoiceCorrectionPanel.test.tsx`,
`ManualInvoiceModal.test.tsx`.
Postgres local usa shims; não comprova Auth/API nem rollout remoto.

## Correções da revisão da PR 839 — 2026-10-02

A migration 130 preserva versões de cobranças Pix locais e apresenta QR pelo
saldo atual; documentos quitados/cancelados não apresentam cobrança. Pix
histórico somente liquida sucessora de mesmo Cliente e composição, com
restituição do excedente. Cancelamento local não invalida QR estático no PSP.

Restituições são distribuídas pelas invoices cujos settlements financiaram o
recebível. COD usa a mesma correção monetária. Alertas resolvem apenas quando
todas as obrigações conferem, e falhas conservam pendência recuperável sem
exigir nova edição do B/L. O botão de retry repete a operação automática e não
permite digitar valores. Esses contratos são pré-requisitos locais da integração
Itaú futura, não a implementação da API bancária.

## Regra de CNPJ definida em 2026-10-04

Quando o Cliente/CNPJ do B/L muda após recebimento verdadeiro, deve-se devolver
o dinheiro ao Cliente original e emitir cobrança para o novo Cliente. O usuário
definiu essa regra na revisão financeira. O recebimento anterior não deve ser
cancelado como se fosse falso nem transferido para o novo Cliente.

Os controles implementados conservam os documentos anteriores e aguardam a
confirmação da devolução para emitir a nova cobrança. Falha de emissão após
devolver conserva uma pendência recuperável. Para avulsa e Demurrage, a
restituição excepcional deve preceder a mudança de Cliente.

A implementação está validada apenas localmente; a migration 136 foi incluída
após autorização explícita. Ver as [decisões implementadas](../archive/specs/2026-10-04-controles-financeiros-design.md)
e o [manual financeiro](../operations/manual-financeiro.md).

## Exceções controladas definidas em 2026-10-05

"Ninguém digita correção" continua valendo para a correção pela base do B/L.
O usuário aceitou duas exceções, ambas com autorização do Administrativo e
confirmação da devolução pelo Financeiro com comprovante, favorecido e data:

- **Cancelamento financeiro de um B/L** em fatura paga ou parcialmente paga:
  a pessoa decide cancelar, mas não digita valor; a cobrança daquele B/L vai a
  zero e o recebido vira restituição, preservando os outros B/Ls da
  consolidada. O cancelamento operacional continua na ficha do B/L.
- **Restituição excepcional de avulsa e Demurrage**, que não têm base de B/L
  para recalcular: o Administrativo informa valor e justificativa, limitados
  ao recebido ainda não reservado para devolução.
