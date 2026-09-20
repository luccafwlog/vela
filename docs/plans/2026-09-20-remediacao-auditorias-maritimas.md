# Remediação das auditorias marítimas — PR 706

## Objetivo

Corrigir, na própria PR 706, os achados executáveis das auditorias de sistemas
críticos e do núcleo de operação marítima, preservando os relatórios históricos
em `docs/archive/audits/`.

## Escopo de execução

1. **Financeiro e Demurrage** — fechar emissão parcial, tornar baixa manual
   idempotente, impedir rateio tardio de container compartilhado e manter o
   recálculo de PTAX independente de disputa.
2. **Importação e taxas** — rejeitar veículo sem medidas positivas e marcar
   tarifa sem unidade como revisão obrigatória, sem transformar `NULL` em zero.
3. **Operação marítima** — corrigir o estado de Atracação atual, ordenar o
   Line-Up por ATB/ATA/ETA, selar mutações de Viagem cancelada, proteger a
   retirada de exportação na camada de dados e eliminar o caminho de POD sem
   COD.
4. **ATD POL** — persistir `laden_on_board` como fato documental e recalcular o
   mínimo canônico da Viagem/POL em uma operação transacional.
5. **Métricas e cache** — adicionar TEU canônico aos cards/snapshot do ADR e
   invalidar a família de Containers após importação de datas.
6. **Evidência** — criar regressões focadas antes de cada alteração, executar os
   gates do repositório e arquivar este plano ao concluir.

## Decisões que não serão inferidas

Os dois conflitos documentais da auditoria permanecem fora da implementação até
decisão explícita: (a) forçar datas idênticas nas linhas de Importação e
Exportação, supersedendo a ADR 0035, e (b) proibir completamente hard-delete de
Viagem, supersedendo a ADR 0024. As demais correções são independentes e serão
entregues agora.

## Verificação

- testes unitários/contratuais focados para cada proprietário alterado;
- `npm run docs:check`, `npm run typecheck`, `npm run lint`, `npm test` e
  `npm run build`;
- `npm run migrations:check` e `npm run rpc:check` para as migrations/RPCs;
- `git diff --check` e revisão final do diff contra `origin/main`.
