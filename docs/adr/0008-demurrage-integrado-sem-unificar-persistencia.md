# 0008 — Demurrage integrado sem unificar persistência

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Persistência própria permanece; o banco calcula a emissão e snapshots de Demurrage. A operação financeira fica em /demurrage, não numa faixa de /faturamento.
> Rastreabilidade: [ADR 0014](./0014-demurrage-recalculo-diario-substitui-roe-congelado.md), [ADR 0050](./0050-financeiro-segregado-por-processo-faturavel.md), [ADR 0065](./0065-inbox-efeitos-e-autoridade-financeira.md); [migration ativa 023](../../supabase/migrations/023_demurrage_calculation_snapshot.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-06-09

## Contexto

Demurrage depende do ciclo físico do container: descarga, devolução, free time, tipo de equipamento, tarifas e eventuais descontos. Embora apareça para o usuário junto de faturamento, portal e conciliação PIX, sua origem de dados é diferente das taxas locais por B/L.

Unificar Demurrage no ledger local simplificaria algumas telas, mas misturaria uma cobrança por container com recebíveis por B/L e aumentaria risco de regressão no cálculo.

## Decisão

Manter Demurrage em persistência própria, integrada nas superfícies financeiras sem absorvê-la pelo ledger local.

- `bl_containers` guarda datas operacionais relevantes para cálculo.
- `demurrage_rates` define tarifas.
- `demurrage_invoices` e `demurrage_invoice_items` representam documentos e itens de Demurrage.
- Services em `src/services/demurrage/` concentram cálculo, listagem, emissão, edição controlada e KPIs.
- O sistema rejeita devolução anterior à descarga na camada de cálculo, UI/importação e constraint de banco.
- `/faturamento`, `/demurrage`, `/reconciliacao` e `/portal/billing` podem exibir Demurrage junto de outras cobranças, mas cada baixa respeita o backend correto: ledger/RPC para taxas locais, atualização própria para Demurrage.

## Consequências

- **Positivas**: cálculo por container continua isolado e testável; a UI financeira entrega visão unificada sem forçar um modelo contábil único; regressões de ledger local não afetam diretamente Demurrage.
- **Negativas / custos**: conciliação PIX precisa tratar fontes diferentes; relatórios e portal precisam agregar famílias de invoice distintas.
- **Regra prática**: integrações devem unificar a experiência do usuário, não necessariamente a tabela de persistência, quando o domínio tem invariantes diferentes.

## Nota editorial — 2026-08-06 (etapa 12 do plano de faturamento, ADR 0038)

A aba Demurrage em `/faturamento` duplicava `/demurrage` — mesma lista, sem os
filtros e a impressão de lá — e a própria aba já declarava isso em card fixo.
O único recurso genuíno era o total consolidado em aberto, que `/demurrage`
não mostra por segregar por status em abas. Decisão: **não unificar a
exibição** de faturas de demurrage na aba Faturas (não viram linhas na mesma
tabela de invoices locais) — a aba, a lista, o modal e a impressão duplicados
saíram; ficou uma faixa de quatro métricas (`DemurrageMetricsStrip`) na aba
Faturas com link para `/demurrage`, onde a gestão de fato acontece. Consistente
com a "regra prática" acima: a experiência ganhou uma visão consolidada sem
mexer em persistência ou tabela.
