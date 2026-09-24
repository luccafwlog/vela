# 0006 — Revisão operacional e reconciliação de cliente como gate de faturamento

> **Nota editorial — 2026-09-23.** A exceção interna da `051` foi retirada pela [ADR 0070](./0070-portal-trava-toda-emissao-e-liberacao-por-cliente.md) (migration `083`): o Portal trava toda emissão, inclusive a automática pelo CE, e a saída sem Portal é a Liberação de faturamento sem Portal, por Cliente, concedida pelo Administrativo.
>
> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Revisão resolve pendências e vínculo de cliente; Validação está em Taxas Locais. CE confirma/emite com a exceção server-side da 051 ao gate de Portal.
> Rastreabilidade: [ADR 0038](./0038-taxa-local-valor-congelado-ancorado-na-escala.md), [ADR 0041](./0041-validacao-fila-de-bloqueios-ce-como-confirmacao.md), [ADR 0050](./0050-financeiro-segregado-por-processo-faturavel.md), [ADR 0054](./0054-portal-como-gate-de-faturamento.md), [ADR 0061](./0061-conciliacao-de-cliente-com-casa-unica-na-revisao.md); [migration ativa 051](../../supabase/migrations/051_ce_mercante_auto_billing.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-06-09

## Contexto

Importações podem chegar com cliente ambíguo, CNPJ ausente, CE Mercante pendente, peso divergente, charge status bloqueante ou dados fiscais insuficientes. Emitir fatura automaticamente nesses casos transforma erro operacional em erro financeiro.

O projeto também precisa tratar `bls` e `granite_bls` no mesmo fluxo de cobrança, apesar de suas origens e tabelas serem diferentes.

## Decisão

Manter uma etapa explícita de revisão operacional e reconciliação de cliente antes de um B/L avançar para faturamento.

- `/revisao` combina pendências de `bls` e `granite_bls`, preservando origem e motivo da pendência.
- Correções de B/L usam RPCs como `save_bl_review` e guardas de concorrência para evitar sobrescrever edição mais recente.
- Reconciliação de cliente fica explícita em fila e só libera o fluxo quando há vínculo seguro com `customers`.
- Taxas locais e Granito convergem para estados operacionais como calculado, pendente de revisão, revisado, pronto para faturar e faturado.
- `/faturamento` mantém uma visão de validação/gargalos antes da emissão; `Pendências` é o subconjunto operacional que bloqueia cálculo ou revisão.

## Consequências

- **Positivas**: reduz emissão indevida; preserva decisão humana onde matching automático é ambíguo; dá aos operadores uma fila clara de trabalho antes do financeiro.
- **Negativas / custos**: o fluxo fica mais lento que uma importação totalmente automática; filtros e contagens precisam explicar por que um B/L ainda não está faturável.
- **Regra prática**: qualquer novo importador ou cálculo que gere incerteza deve alimentar revisão/reconciliação, não pular direto para invoice.

## Nota editorial — 2026-06-19

O gate foi tornado canônico e centrado em "o cliente consegue ver a fatura no portal":

- As pendências que prendem um B/L passam a ser derivadas de estado real por `compute_bl_review_pendencies(bl)` (não do texto de `notes`), e `save_bl_review` recomputa `review_status` — só libera quando o conjunto zera. Isso fecha o vazamento em que corrigir uma de várias pendências liberava o B/L prematuramente.
- O conjunto de travas inclui agora **e-mail do cliente** (qualquer contato) e **acesso ao portal realmente provisionado** (`active = true` e `auth_user_id` preenchido), além de cliente vinculado e inputs de cálculo. **CE Mercante não é trava** (necessário para exibição no portal, mas não inserido neste momento).
- Todas as travas são resolvíveis dentro da própria revisão, agrupadas por cliente (CNPJ): vínculo, e-mail e provisionamento de portal (admin-only, com senha gerada pelo sistema) em lote.
- A **justificativa** da correção passou a ser opcional (auto-preenchida como "Revisão manual"); a trilha de auditoria (quem/o quê/antes/depois) permanece automática.
- O cliente não declara nem audita `review_status`: o banco calcula a transição real, descarta qualquer linha de auditoria de status enviada pelo frontend e grava o antes/depois efetivo.
- O mesmo gate é aplicado depois de novas importações e novamente nas fronteiras de `ready_for_billing`/invoice. Helpers que leem relações administrativas são `SECURITY DEFINER`, com `search_path` fixo e sem `EXECUTE` para `PUBLIC`, `anon` ou chamadas diretas de `authenticated`.
- A correção é **prospectiva**: não há backfill top-level. B/Ls históricos já faturados não são reabertos nem têm o status reescrito.

## Nota editorial — 2026-08-16 (supersedida pela ADR 0054)

A migration `188_review_gate_remove_portal.sql` registrou temporariamente a
retirada do Portal do gate. A ADR 0054 reverte essa decisão de produto: a
prontidão da Conta de Portal volta a ser condição obrigatória de revisão e
faturamento, e a restauração deve ocorrer em migration nova. A nota permanece
somente como histórico da mudança intermediária; não é contrato vigente.
