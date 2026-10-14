# 0042 — CE Mercante confirma o cálculo em todos os modos

> **Situação atual (2026-10-13).** O CE Mercante continua obrigatório para faturar container, carga solta e misto, e Embarque de Vazios segue fora. Para o Granito as decisões 1, 3 e 4 não valem mais: ele é apoio operacional, não emite invoice nem recebível, e o CE de Granito não dispara cálculo nem emissão automáticos (decisão do dono de 2026-09-23, mantida pela [ADR 0078](./0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md), item 8).
> A unicidade da decisão 2 foi refinada pela ADR 0078, item 3: um CE só pode estar em um B/L não cancelado, somando carga e Granito, por gatilho no banco; B/L cancelado libera o CE.
> Regra vigente em [Faturamento](../modules/faturamento.md), seção "Propósito e escopo", e em [Granito](../modules/granito.md).

> **Nota editorial — 2026-09-23 · supersedida parcialmente.** As decisões 3 e 4
> não valem mais para o Granito: ele é apoio operacional, calcula taxas para
> conferência e não emite invoice nem recebível. A Validação o classifica como
> *Apoio operacional — Granito*, e o CE de Granito não dispara faturamento. Isso
> foi confirmado com o dono do produto em 2026-09-23. A exigência de CE para
> faturar continua valendo nos demais modos (container, carga solta e misto).
> Rastreabilidade: [Granito](../modules/granito.md);
> `src/components/billing/validacaoPipeline.ts`;
> [plano de alinhamento](../archive/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md).
> O texto original abaixo preserva o contexto da decisão.

Status: supersedida parcialmente — 2026-09-23 (original: aceito — 2026-08-10)

## Contexto

O CE Mercante já confirmava o cálculo e a emissão automática para B/Ls de
container. Granito mantinha um caminho separado: calculava taxas e dependia do
clique manual de “Marcar pronto p/ faturar”. A operação confirmou que carga de
exportação emite CE Mercante, exceto Embarque de Vazios.

## Decisão

1. `granite_bls.ce_mercante` é obrigatório para faturar Granito e é persistido
   pelo mesmo import de CE usado pelos demais B/Ls.
2. A relação CE × B/L é 1:1. Um índice único parcial impede reutilização de CE
   preenchido e permite registros ainda sem CE.
3. O cadastro do CE recalcula e emite a invoice de Granito quando o cliente está
   vinculado. A emissão interna marca o B/L como `ready_for_billing`.
4. A fila de Validação classifica Granito sem CE como “Aguardando CE Mercante”.
   O lote não oferece mais a marcação manual como etapa normal; a exceção
   operacional é a emissão individual pelo botão “Emitir”, que continua
   exigindo CE, cliente, cálculo e o guard do workflow.
5. Embarque de Vazios não participa: é módulo de custo da agência e não gera
   invoice ou recebível de cliente.

## Consequências

Granito sem CE pode aguardar faturamento por mais tempo, mas segue a mesma
fronteira documental dos demais modos. O import de CE passa a ter destino
explícito (`bls` ou `granite`), resolve o número do B/L pela viagem selecionada,
audita a alteração via RPC e o campo é exposto no contrato gerado do banco.
