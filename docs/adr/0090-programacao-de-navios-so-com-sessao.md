# 0090 — A programação de navios do Portal só com sessão; nenhuma função para `anon`

> **Situação atual (2026-10-20).** "Sessão" passou a ser checada no corpo, não só no grant: desde a migration `337`, `portal_ship_schedule()` atende usuário interno ativo (`is_active_read_user()`), conta ativa do Portal com credencial não revogada (`current_portal_customer_id()`) ou `service_role`, e recusa as demais contas `authenticated` com 28000. A auditoria defensiva de 2026-10-19 achou o cadastro público do Auth de produção aberto, o que dava a qualquer pessoa uma conta `authenticated` capaz de ler a programação. Continua sem guarda de Cliente, como diz a consequência abaixo. Regra vigente em [Segurança](../operations/seguranca.md#rls-first).
>
> **Situação atual (2026-10-22).** O item 1 ganhou uma exceção: desde a migration `410` ([ADR 0097](./0097-corte-do-token-interno-na-revogacao.md)), `check_internal_token_cutoff()` é executável por `anon`, porque o PostgREST a chama antes de toda requisição, com o papel da requisição. Ela não lê nem devolve dado; sem sessão, não faz nada. A suíte local-pg aceita só essa função na varredura de `anon`.

Status: supersedida parcialmente — 2026-10-19 (pedido do responsável a partir do advisor de
segurança do Supabase de 19/10/2026). Implementada na migration `320`, com a
suíte `src/integration/advisorFuncoesFechadas.local-pg.test.ts`.

Supersede parcialmente a [ADR 0047](./0047-grants-de-funcao-fechados-por-padrao.md)
no item 4 (a exceção pré-autenticação `portal_ship_schedule()`). O restante da
0047, o default fechado e a concessão caso a caso, continua valendo.

## Contexto

A ADR 0047 manteve `portal_ship_schedule()` executável por `anon` como vitrine
pública da programação de navios. O advisor de 19/10/2026 a apontou, junto com
dez funções de trigger `SECURITY DEFINER` que em produção tinham `EXECUTE` para
`PUBLIC` (e, por herança, para `anon` e `authenticated`).

Com esta mudança, nenhum chamador usa a função sem sessão:

- no Portal, `usePortalScheduleVoyages` só consulta com o Cliente autenticado
  (`enabled: isAuthenticated || readOnly`), e o Painel (`/portal`) fica atrás
  de `PortalProtectedRoute`;
- a inspeção chama com a sessão interna; `/chegadas-saidas` chamava pelo
  cliente do Portal, que no Vela não tem login e caía em `anon`, e passou a
  usar a sessão interna (`fetchInternalScheduleVoyages`) na mesma mudança;
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
   `anon`, trigger aberta, função sem `search_path` fixo (fora as quatro
   funções SQL de volume que ficam inline por desempenho, em
   [Segurança](../operations/seguranca.md#rls-first)) ou FK de B/L, fatura
   ou Demurrage sem índice falham o CI.

Reabrir uma leitura antes do login exige ADR nova, grant explícito, controle
contra abuso e teste focado ([WORKFLOW.md](../../WORKFLOW.md#segurança)).

## Consequências

- Uma página pública futura com a programação precisa de outro caminho (Edge
  Function com `service_role` ou nova decisão); hoje nenhuma existe.
- A função continua sem guarda de Cliente: toda sessão do Portal, de qualquer
  Cliente, e toda sessão interna lê a mesma programação. A trava da ADR 0047
  continua: nenhum campo de cliente, fatura, B/L, container ou contato entra
  na projeção sem nova decisão.
- O advisor de segurança deixa de listar `anon_security_definer_function_executable`.
- O drift de produção em grants só aparece no advisor ou numa consulta ao
  catálogo remoto; o replay local prova o estado da cadeia, não o do projeto.
