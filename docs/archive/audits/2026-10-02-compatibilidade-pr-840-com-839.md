# Compatibilidade da PR 840 com a PR 839

Revisão do head `3dab4785` contra `main` em `c004b2cb`, após o squash da
PR 839. Registro histórico da remediação; o estado de publicação e CI está na
[PR 840](https://github.com/luccafwlog/vela/pull/840).

## Achados e correções

- **Base antiga e conflitos:** a 840 dependia de uma versão intermediária da
  branch da 839. A reconstrução aplica somente os dois commits próprios da 840
  sobre `main`, resolve os cinco arquivos conflitantes e elimina um import
  duplicado de `afterBaplieImportado`. A base de integração passa a ser `main`.
- **Projeções financeiras desatualizadas:** a nova lista de efeitos de cache
  omitia restituições, COD, faturas do Portal e histórico de conciliação.
  `FINANCIAL_READ_KEYS` reutiliza `INVOICE_BASIS_CACHE_KEYS`, preservando os
  consumidores da 839 em edição de carga, manifesto, Baplie, cancelamento de
  B/L e alteração de viagem.

Os cinco cenários adicionais em `operationalCacheRefresh.test.ts` usam
QueryClient e QueryObserver reais, com consultas abertas e `staleTime` infinito.
Contra o serviço original da 840, os cinco falharam porque a restituição
continuava com o dado anterior. Com a lista financeira preservada, os cinco
passaram: restituições, COD, faturas do Portal e histórico de conciliação foram
atualizados sem recarregar a página.

## Evidência e limites

A reconstrução local foi validada por 3.825 testes gerais e 44 testes focados;
286 testes gerais foram ignorados pelas condições do ambiente. Typecheck,
lint, documentação, build, limites de bundle e `git diff --check` passaram.
Após acrescentar os cinco cenários, os 49 testes focados passaram; typecheck,
lint e documentação foram verificados novamente. Os resultados do CI do commit
publicado são registrados na PR.

Migrations, regras financeiras, serviço de conciliação e biblioteca Pix da 839
permanecem idênticos aos da `main`. Esta remediação não implementa API Itaú,
cancelamento bancário de QR ou webhook, e não comprova sincronização entre
usuários, navegador autenticado ou execução remota de RLS. Os testes de telas
usam jsdom e serviços simulados.
