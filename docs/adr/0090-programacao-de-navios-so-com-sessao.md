# 0090 — A programação de navios do Portal só com sessão; nenhuma função para `anon`

Status: aceito — 2026-10-19 (pedido do responsável a partir do advisor de
segurança do Supabase de 19/10/2026). Implementada na migration `302`, com a
suíte `src/integration/advisorFuncoesFechadas.local-pg.test.ts`.

Supersede parcialmente a [ADR 0047](./0047-grants-de-funcao-fechados-por-padrao.md)
no item 4 (a exceção pré-autenticação `portal_ship_schedule()`). O restante da
0047, o default fechado e a concessão caso a caso, continua valendo.

## Contexto

A ADR 0047 manteve `portal_ship_schedule()` executável por `anon` como vitrine
pública da programação de navios. O advisor de 19/10/2026 a apontou, junto com
dez funções de trigger `SECURITY DEFINER` que em produção tinham `EXECUTE` para
`PUBLIC` (e, por herança, para `anon` e `authenticated`).

Nenhum chamador usa a função sem sessão:

- no Portal, `usePortalScheduleVoyages` só consulta com o Cliente autenticado
  (`enabled: isAuthenticated || readOnly`), e o Painel (`/portal`) fica atrás
  de `PortalProtectedRoute`;
- na inspeção e em `/chegadas-saidas`, a chamada sai com a sessão interna;
- nenhuma Edge Function a chama.

As dez funções de trigger eram resíduo da cadeia arquivada: a varredura da
migration `003` nunca rodou em produção, porque o histórico remoto já tinha a
versão `003` quando a cadeia foi consolidada ([ADR 0062](./0062-consolidacao-migrations-schema-1-0.md)).
O replay local as cria fechadas, então o CI não enxergava a diferença.

## Decisão

1. `portal_ship_schedule()` deixa de ser executável por `PUBLIC` e `anon`;
   `authenticated` e `service_role` continuam. Não há mais função
   pré-autenticação no banco.
2. Função de trigger não é executável por `PUBLIC`, `anon` nem
   `authenticated`: roda pelo trigger, com o privilégio do dono.
3. A migration que mexe em grants falha o deploy se sobrar função do projeto
   executável por `anon` ou trigger executável por cliente, em vez de deixar o
   advisor descobrir depois.
4. A suíte local-pg varre o catálogo inteiro: função nova executável por
   `anon`, trigger aberta, função sem `search_path` fixo ou FK de B/L, fatura
   ou Demurrage sem índice falham o CI.

Reabrir uma leitura antes do login exige ADR nova, grant explícito, controle
contra abuso e teste focado ([WORKFLOW.md](../../WORKFLOW.md#segurança)).

## Consequências

- Uma página pública futura com a programação precisa de outro caminho (Edge
  Function com `service_role` ou nova decisão); hoje nenhuma existe.
- O advisor de segurança deixa de listar `anon_security_definer_function_executable`.
- O drift de produção em grants só aparece no advisor ou numa consulta ao
  catálogo remoto; o replay local prova o estado da cadeia, não o do projeto.
