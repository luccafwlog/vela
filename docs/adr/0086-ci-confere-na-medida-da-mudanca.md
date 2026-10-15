# 0086 — O CI confere na medida do que a PR muda

Status: aceito — 2026-10-15 (decisões do dono D1 e D2 do
[plano de compactação do CI](../archive/plans/2026-10-15-compactacao-do-ci.md)).
Estende a [ADR 0010](./0010-validacao-testes-deploy-gates.md). Regra vigente
em [WORKFLOW.md](../../WORKFLOW.md), seções "11. Testes e validação" e
"12. CI e deploy", e em [Deploy](../setup/deploy.md#workflows).

## Contexto

O CI de uma PR passou de ~1 min (2026-09-01) a ~11 min (2026-10-14), com ~21
minutos cobrados por run e ~13 min do merge à produção
([medição](../archive/reports/2026-10-15-medicao-do-tempo-do-ci.md)). 85% do
tempo vinha das suítes SQL (`*.local-pg.test.ts`), rodadas em toda PR e duas
vezes (ordem natural e invertida). O CI rodava de novo na `main` depois do
merge, e a produção esperava esse segundo CI. Os robôs de preview disparavam
depois de todo CI verde e terminavam em falha, porque o Automatic Branching do
Supabase está desligado.

## Decisão

1. **Toda PR** continua conferindo documentação, lint, identidade visual,
   build dos dois sites, testes comuns (inclusive os de tela), guardas de
   segurança, o replay das migrations num PostgreSQL 16 real, as invariantes
   do schema, o catálogo de RPCs e o seed.
2. **As suítes SQL e a bateria financeira** rodam quando o diff da PR toca o
   banco, as próprias suítes, o que monta o banco ou as dependências, o
   `ci.yml` ou o classificador (`scripts/ci-db-paths.mjs`). A condição fica nos
   passos; nenhum job é pulado e o check `checks` continua exigindo todos.
3. **A passada em ordem invertida** sai da PR e roda toda semana, e por
   disparo manual, no workflow `local-pg-order.yml`.
4. **O CI não roda depois do merge.** A produção publica no push em `main`
   depois que a integração do Supabase aplica as migrations do commit (D1):
   check verde publica; vermelho recusa; pulado ou ausente só publica quando o
   push não muda `supabase/migrations/`. O disparo manual publica sem esperar.
5. **A PR não precisa estar atualizada com a `main`** antes do merge (D2). Se
   duas PRs verdes quebrarem juntas, a PR seguinte fica vermelha e mostra o
   problema; reavaliar se acontecer.
6. **Previews só por etiqueta** `preview` ou disparo manual a partir da `main`.
7. Menos jobs por run: `quality`, `test` (em shards), `db` e `checks`.
8. **As suítes SQL usam uma conexão por arquivo** (`execPsql`/`spawnPsql` em
   `src/integration/localPsql.ts`), com a sessão limpa entre chamadas, em vez
   de um processo `psql` e uma conexão por chamada; `npm run localpg:check`
   recusa o `psql` síncrono nas suítes.

## Consequências

- Uma PR de tela espera ~3 min; uma PR de banco, ~6 min; o merge chega à
  produção em ~2 min (estimativas do plano, medidas na PR luccafwlog/vela#953).
- Uma dependência de ordem entre suítes aparece em até uma semana, como alerta
  do workflow semanal, não na PR que a criou.
- Uma PR que só muda tela e chame RPC inexistente continua barrada pelo
  `rpc:check`, que roda em toda PR.
- A proteção contra publicar código antes da migration passa a depender do
  check do app `supabase` no commit da `main`.
