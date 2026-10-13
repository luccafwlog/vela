# 0014 — Demurrage: recálculo diário substitui ROE congelado na emissão

> **Situação atual (2026-10-13).** Continuam valendo o USD fixado na Invoice, o BRL recalculado pela PTAX até o pagamento, o markup 1,065 e o congelamento no pagamento; o job da PTAX foi agendado em 2026-10-07.
> Mudou a emissão: uma Invoice por grupo de B/Ls do mesmo Cliente que dividem container, emitida quando todos voltam, com cada caixa cobrada uma vez e Invoice complementar para a caixa nova ([ADR 0078](./0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md), item 20; [ADR 0080](./0080-decisoes-da-revisao-final-da-pr-929.md)); data corrigida cancela e reemite a Invoice sem pagamento, e a com desconto ou disputa fica suspensa ([ADR 0078](./0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md), item 19; [ADR 0079](./0079-decisoes-pendentes-da-revisao-da-pr-929.md)). O banco é a autoridade do cálculo e do snapshot ([ADR 0065](./0065-inbox-efeitos-e-autoridade-financeira.md)).
> Decisão pendente: `demurrage_invoices.due_date` existe e a ficha do Cliente conta Invoice de Demurrage vencida, contra o "não há `due_date`" abaixo.
> Regra vigente em [Demurrage](../modules/demurrage.md), seção "Fluxos e invariantes", e em [Regras de negócio](../operations/regras-de-negocio.md), seção "Câmbio (ROE / PTAX)".

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Princípio de câmbio permanece; cálculo autoritativo e snapshots são server-side. A existência da Edge Function não prova ativação remota do job PTAX.
> Rastreabilidade: [ADR 0065](./0065-inbox-efeitos-e-autoridade-financeira.md); [migration ativa 028](../../supabase/migrations/028_demurrage_roe_integrity.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-06-24

## Contexto

O modelo original (ver 0008) congelava o ROE na emissão da invoice (`frozen_roe`,
`frozen_total_brl`) e tratava o markup 1,065 como proteção cambial. O processo real do armador é
outro: o valor em BRL de uma fatura **não paga** deve acompanhar a PTAX divulgada diariamente, e o
markup é um **spread fixo do armador**, não proteção contra flutuação.

O sistema interno antigo (`demurrage-manager`) **congela o valor no envio da fatura ao cliente**,
porque não tem portal — o cliente recebe um documento/QR estático e não se pode mudar depois o que
foi cobrado. O Transhipping Desk **tem portal**, onde o cliente sempre vê o valor atualizado; logo
o valor pode flutuar **até o pagamento** ("como se faturasse diariamente"), sem precisar congelar no
envio. Não existe, portanto, estágio "enviado" no TD.

## Decisão

Enquanto a invoice de Demurrage não estiver paga, seu valor em BRL é recalculado a cada nova PTAX:

- **USD travado na emissão** (a invoice só é emitida quando todos os containers do B/L voltaram, com
  os dias fixos); apenas o câmbio flutua. O recálculo nunca recomputa dias.
  `total_brl = (total_usd − desconto_usd) × ptax × 1,065`.
- O markup 1,065 é spread fixo; fica no código, **centralizado num único ponto canônico**.
- As colunas deixam de se chamar `frozen_roe`/`frozen_total_brl` e passam a
  `current_roe`/`current_total_brl` (não há mais congelamento na emissão). O congelamento real ocorre
  **no pagamento** (`source='payment'` no histórico).
- Descontos sempre em USD, antes da conversão. Disputas são ortogonais (nunca bloqueiam recálculo nem
  pagamento). Não há `due_date`/`overdue`.
- A emissão é **automática na importação** quando todos os containers voltaram; devolução parcial não
  emite nada. A foto inicial é gravada no histórico já na emissão.

Arquitetura de execução:

- **RPC núcleo** `recalculate_demurrage_invoices(p_ptax, p_quote_date, p_source)`: `SECURITY DEFINER`,
  **sem** checagem de `auth.uid()`, executável só por `service_role`. Recalcula e grava o histórico,
  **apenas quando a PTAX muda**.
- **Wrapper manual** autenticado (`auth.uid()`/`is_active_user()`) para o modal "Informar PTAX".
- **Edge Function** agendada (dias úteis, ∼14h) que busca a PTAX e chama a núcleo via `service_role`.
  Necessária porque o portal precisa do valor/QR atualizados mesmo sem ninguém com a página aberta —
  diferente do sistema antigo, que recalculava no navegador a cada render.
- **Política de busca da PTAX = a do sistema antigo:** `CotacaoDolarPeriodo` dos últimos ∼10 dias,
  `top 1` por `dataHoraCotacao desc`. Nunca pede "a de hoje" — pega a cotação mais recente; fim de
  semana/feriado/antes-da-divulgação não falham. Falha só em erro de API → caminho manual (raro).
  A `event_date` no histórico é a **data da cotação**, e novas linhas só são criadas quando a PTAX
  muda (sem duplicatas de fim de semana).

## Consequências

- **Positivas:** o valor cobrado reflete o câmbio corrente; o portal expõe o valor atualizado sem
  documento estático; histórico imutável dá auditoria e base para a conciliação; separar núcleo/wrapper
  evita o bug de um job sem sessão de usuário cair no guard `auth.uid()`; a busca por período torna a
  PTAX praticamente sempre disponível.
- **Negativas / custos:** renomear `frozen_*` toca arquivo protegido (`src/types/database.ts`,
  autorizado) e ∼27 arquivos; passa a existir infra de Edge Function + agendamento a operar; faturas
  emitidas após o recálculo do dia precisam da foto inicial na emissão.
- **Relação:** estende a 0008 (Demurrage segue em persistência própria), trocando o modelo de valor
  congelado-na-emissão pelo recálculo diário até o pagamento.
