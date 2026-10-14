# 0051 — COD reprecifica a Taxa Local no destino final, com ajuste financeiro registrado

> **Situação atual (2026-10-14).** Vale: o COD reprecifica a Taxa Local pelo destino final, Transbordo e Omissão não; o B/L não faturado recalcula no ato; a reversão é simétrica, exige justificativa, e o CE do B/L não muda. Não vale mais a forma do ajuste em B/L já faturado (ramos faturados da decisão 2 e decisão 3): desde a correção automática da [ADR 0077](./0077-fatura-emitida-nao-muda-de-valor.md) (migrations `128` e `130`), sem pagamento a fatura é cancelada e reemitida sozinha; com pagamento, a redução abate o saldo e restitui o excedente, o aumento vai em fatura avulsa, e o Ajuste de COD é liquidado por essa correção. A ADR 0077 diz não alterar o ajuste de COD, mas sua seção de 2026-10-02 e o código o incluem; a [ADR 0083](./0083-decisoes-da-revisao-geral-da-documentacao.md) (item 11) decide que a ADR 0077 vale também para o COD, com o Ajuste de COD liquidado pela fatura sucessora, sem "Cancelar e reemitir". O painel de COD ainda pede "Cancelar e reemitir", com correção pendente no [plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md).
> As migrations `108`, `111`, `291` e `308`–`316` citadas abaixo são da cadeia arquivada (`supabase/migrations_archive/`), anterior à consolidação da ADR 0062.
> Regra vigente em [Faturamento](../modules/faturamento.md), seções "Correção após emissão (ADR 0077)" e "Segurança da correção automática — migration 130".

Status: supersedida parcialmente — 2026-08-18

Supersede parcialmente a [ADR 0038](./0038-taxa-local-valor-congelado-ancorado-na-escala.md),
decisão 1.

## Contexto

A [ADR 0022](./0022-omissao-escala-transbordo-cod-registro-operacional.md)
registrou Omissão de Escala, Transbordo e COD como evento operacional, deixando
o financeiro manual. A [ADR 0038](./0038-taxa-local-valor-congelado-ancorado-na-escala.md)
foi além e declarou, na decisão 1, que o fato gerador da Taxa Local é a emissão
do CE Mercante e que **COD não altera a taxa**: "no COD o cliente retira em
outro porto por conveniência própria e o desvio é ônus operacional do armador".

A [revisão de 2026-08-18](../archive/audits/2026-08-18-revisao-transbordo-cod.md)
confrontou essa regra com a operação e com o código, e encontrou duas coisas.

**A regra estava errada.** A Taxa Local é cobrança de chegada no destino final.
O COD muda o destino final. Logo a taxa devida passa a ser a do novo destino —
não por conveniência de cálculo, mas porque é o mesmo princípio que já governa o
transbordo, onde o destino final é preservado e a taxa não muda.

**E ela não estava sendo aplicada de qualquer forma.** `set_bl_cod` reescreve
`bls.pod`, e `calculate_bl_local_charges` resolve a tabela de taxas por
`bls.pod`. Como nada no fluxo de COD dispara recálculo, o resultado dependia de
o B/L ser tocado depois ou não: sem toque, a taxa ficava no porto antigo; com
uma reimportação qualquer, migrava sozinha. O mesmo COD produzia dois
resultados financeiros diferentes.

Não há CODs nem transbordos em produção, então nenhuma cobrança já emitida
depende da regra anterior.

## Decisão

**1. A Taxa Local é devida no destino final do B/L.** COD reprecifica; Omissão
de Escala e Transbordo não, porque neles o destino final é preservado — a carga
segue por navio de terceiro até o POD original. A frase da ADR 0038 decisão 1
sobre "porto declarado no CE" fica sem efeito: o CE Mercante é o **fato
gerador** da cobrança, não o seletor do preço, e o schema nunca vinculou um CE a
um porto (`bls.ce_mercante` é `TEXT` livre).

**2. A reprecificação acontece no ato do COD, com forma definida pelo estado
financeiro do B/L:**

| Estado | Comportamento |
|---|---|
| Não faturado | Recalcula na própria transação do COD. |
| Faturado, não pago | O COD registra a pendência de cancelar e reemitir pela tabela do novo destino; o Financeiro executa. Nenhum dinheiro trocou de mãos; corrige-se o documento. |
| Faturado, pago em parte | A fatura original permanece. A diferença é apurada **contra o saldo em aberto primeiro**: valor a mais vira Fatura Complementar de COD; valor a menos abate o saldo devedor, e só o que exceder o que já entrou vira restituição. |
| Faturado e pago integralmente | A fatura original permanece. A diferença vira **Ajuste de COD**: Fatura Complementar de COD quando falta valor, restituição quando sobra. |

A fronteira é o dinheiro que efetivamente entrou: **antes dele corrige-se o
documento; depois dele ajusta-se a diferença — e nunca se devolve o que não foi
recebido.** Cancelar documento fiscal já quitado seria o caminho mais sujo, e é
o que a migration `108` já tenta impedir ao bloquear edição de linha de fatura
com pagamento.

O pagamento parcial é ramo próprio porque tratá-lo junto com o pago integral
devolve dinheiro que nunca entrou: numa fatura de R$ 100 com R$ 10 pagos, um COD
que reduz a cobrança para R$ 80 não gera restituição de R$ 20 — gera abatimento
de R$ 20 no saldo, que cai de R$ 90 para R$ 70. Restituição só existe quando o
pago supera o devido pela tabela do novo destino.

**A restituição de COD não cabia em `invoice_refunds` como a tabela estava.**
`invoice_refunds.payment_id` era `NOT NULL` (migration `111`): a restituição
existia presa a um pagamento específico, porque nasceu do excedente de um
pagamento. Um crédito de COD nasce da reprecificação, não de um pagamento a
mais. A tabela passa a aceitar duas procedências — `payment_id` ou
`cod_adjustment_id`, exatamente uma delas, por `CHECK` — e deixa de ser
"excedente de pagamento" para ser "crédito ao cliente". Ancorar o crédito de COD
num pagamento existente foi considerado e recusado: o `ON DELETE CASCADE` da
coluna faria o estorno daquele pagamento apagar, em silêncio, uma restituição
que não tinha relação com ele.

**3. O COD calcula e registra a diferença; a emissão do ajuste é ato do
Financeiro.** Quem marca COD é Documentação. Emitir fatura complementar e
liberar restituição são atos deliberados, coerentes com a ADR 0007 (ciclo de
vida da invoice) e a ADR 0009 (bloqueios fiscais). O número existe e é auditável
no instante do COD; o documento sai depois, por outra pessoa.

**4. Reverter COD para transbordo é simétrico** — restaura o destino final
original e reprecifica pelas mesmas regras da decisão 2. Assimetria produziria o
pior defeito possível: taxa de um porto num B/L cujo destino é outro, sem sinal
na tela.

**5. COD é ato deliberado com justificativa.** Exige confirmação explícita e
justificativa do operador, gravada em `audit_logs` — não a literal fixa que a
RPC gravava. O COD deixou de ser só registro operacional: ele é o gatilho
financeiro do desvio.

**6. O CE Mercante do B/L nunca muda; a participação em manifesto muda.** O
número do CE individual é do conhecimento e permanece em qualquer hipótese. O
CE Master (manifesto) também não muda de identidade nem de número — mas um B/L
em COD **deixa o manifesto do porto omitido e passa a constar no manifesto do
novo destino**. Se essa rota ainda não existir na viagem, ela nasce sem
manifesto e o pendente fica visível até alguém informar o número.

## Consequências

- A decisão 1 da ADR 0038 deixa de valer. As decisões 2 (congelamento na
  emissão), 4 e 5 permanecem, assim como a decisão 3 na redação que a
  [ADR 0040](./0040-vigencia-da-tabela-de-taxas-e-informativa.md) lhe deu.
- O verbete **COD** do `CONTEXT.md` foi reescrito, e **Ajuste de COD** entrou
  como termo novo.
- A ADR 0022 continua válida no que decidiu: omissão distinta de exclusão,
  navio de transbordo como referência leve, disposição individual por B/L. O que
  muda é a frase "mantém efeitos financeiros manuais" — o efeito da Taxa Local
  passa a ser calculado; CE Mercante e Demurrage seguem manuais.
- Demurrage não é afetado: `demurrageRates.ts` não consulta `bls.pod` para
  resolver tarifa ou free time.
- Sem CODs em produção, não há backfill nem reprecificação retroativa.
- Resolver o Ajuste de COD é ato do Financeiro, e o schema não permitia isso:
  `settle_invoice_refund` e as policies de escrita de `invoice_refunds` exigiam
  `is_admin()`, que cobre apenas `admin` e `administrativo`. Entra
  `is_financeiro_user()` — `admin`, `administrativo` ou `financeiro`, ativo —
  aplicado **somente** à escrita de `invoice_refunds` e `cod_adjustments` e ao
  gate de `settle_invoice_refund`. `is_admin()` não é alargado: ele é a porta
  geral de administração em cerca de 60 migrations, e alargá-lo daria ao
  Financeiro painel admin, gestão de usuários e provisionamento do Portal junto.
  A leitura já foi aberta a qualquer usuário ativo pela migration `291`.
- Promover o **manifesto a entidade própria** — para suportar cancelar um
  manifesto e consolidar seus CEs em outro — fica fora desta decisão e exige
  desenho próprio.

## Implementação na PR 553

A entrega foi consolidada nas migrations `308`–`316`. O COD agora exige
confirmação e justificativa, reprecifica a Taxa Local por uma função pura de
destino e registra a diferença em `cod_adjustments`; abatimentos são aplicados
antes de restituições, e a emissão de fatura complementar ou restituição
continua sendo uma ação manual do Financeiro. `invoice_refunds` aceita a
procedência `cod_adjustment_id` sem amarrar o crédito a um pagamento alheio.

A mesma entrega restaura os dados globais de transbordo na omissão, torna a
reversão explícita e auditada, e corrige o Portal, Line-Up e programação para
exibir escala omitida como `OMIT`. A disposição por B/L permanece em
`bl_transshipments`; os campos `onward_*` vivem apenas em `voyage_omissions`,
evitando duas fontes de verdade. Complementar sem mudança não gera auditoria,
e motivo vazio preserva o motivo existente.
