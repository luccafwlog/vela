# 0097 — Corte do access token interno na revogação

Status: aceito — 2026-10-22 (pedido do responsável para corrigir os achados da
auditoria de segurança run-3; achado C1). Implementada na migration `410`, com
a suíte `src/integration/corteTokenInterno.local-pg.test.ts`.

Supersede parcialmente a [ADR 0090](./0090-programacao-de-navios-so-com-sessao.md)
no item 1 ("Não há mais função pré-autenticação"): abre uma exceção, a
`check_internal_token_cutoff()`, executável por `anon` porque o PostgREST a
chama antes de toda requisição. O restante da 0090 continua valendo.

## Contexto

Editar acesso (troca de e-mail ou senha) e Desativar encerram as sessões do
usuário interno por `internal_revoke_sessions` (migration `106`). A função
apagava sessões e refresh tokens, mas não registrava o instante da revogação.
O PostgREST aceita qualquer JWT assinado e não expirado, e os helpers de papel
(`is_active_user`, `is_active_read_user`, `is_admin`, `is_financeiro_user`,
`_portal_actor_role`, `current_actor_role`) decidiam só por
`user_profiles(active, role)`. Resultado: quem tivesse o access token emitido
antes da troca seguia com toda a autoridade do Departamento até o token
expirar (até 1 hora). Desativar só fechava enquanto o perfil ficasse inativo;
reativar dentro da janela devolvia a autoridade ao token antigo.

O Portal já fechava a mesma lacuna com `credentials_revoked_at` e o corte
estrito por `iat` em `current_portal_customer_id()` (migrations `069`, `092`
e `132`).

Além dos helpers, 22 funções executáveis por `authenticated` e seis políticas
liam `user_profiles` direto para decidir permissão. Corrigir só os helpers
deixaria essas leituras aceitando o token antigo.

## Decisão

1. `internal_revoke_sessions` grava o marco (`clock_timestamp()`, depois de
   apagar sessões e refresh tokens, sob lock do perfil) em
   `internal_credential_revocations`. A tabela não tem grant para `anon` nem
   para `authenticated`: numa coluna de `user_profiles` o próprio token antigo
   apagaria o marco pela política de autoedição.
2. `_internal_token_current()` recusa o token do próprio usuário (claim `sub`
   igual a `auth.uid()`) quando o `iat` falta, não é numérico ou é anterior ao
   marco. É a mesma regra do Portal. Rotina de serviço que age em nome do
   usuário (troca `request.jwt.claim.sub` e carrega o JWT do `service_role`,
   migrations `385`, `386` e `394`) não é cortada: a ação foi autorizada antes,
   e quem não está mais ativo continua recusado pelo `active`.
3. Os seis helpers de papel e `ce_unlock_private.actor` passam a exigir o
   token vigente. As seis políticas que liam `user_profiles` direto passam a
   chamar os helpers, com as mesmas condições.
4. `check_internal_token_cutoff()` roda antes de toda requisição do PostgREST
   (`pgrst.db_pre_request` no papel `authenticator`) e responde `28000` ao
   token antigo. Ela cobre as funções que ainda leem `user_profiles` no corpo,
   inclusive as que vierem depois, sem reescrever cada uma. O PostgREST a chama
   com o papel da requisição, então ela é executável por `anon`; sem sessão,
   não faz nada. É a única exceção à regra "nenhuma função para `anon`".
5. No app interno, perfil que não carrega com `28000` encerra a sessão local,
   como perfil inativo. Quando o Administrativo troca a própria credencial em
   Editar acesso, a `admin-users` audita antes de revogar e avisa a tela, que
   encerra a sessão e pede um novo login.

## Consequências

- A revogação vale na hora para a API de dados e para o Storage, que avalia as
  políticas pelos helpers. O `db_pre_request` não roda no Storage nem no
  Realtime; o app não usa Realtime.
- Cada requisição autenticada faz uma consulta por chave primária a mais, numa
  tabela que só tem uma linha por usuário já revogado.
- Token emitido no mesmo segundo do marco é recusado, porque o `iat` tem
  resolução de segundo. Na prática quem é revogado só entra de novo depois.
- A troca de senha pelo próprio usuário em Meu perfil não passa por
  `internal_revoke_sessions` e não grava marco; essa troca segue o contrato do
  Supabase Auth.
- O replay local não tem o papel `authenticator`: a migration só grava o
  `db_pre_request` onde o papel existe (projeto e branches do Supabase). Para
  conferir num projeto, leia `rolconfig` de `authenticator` em `pg_roles`.
- Rollback: `ALTER ROLE authenticator RESET pgrst.db_pre_request` seguido de
  `NOTIFY pgrst, 'reload config'`; os helpers, `ce_unlock_private.actor` e as
  políticas voltam pelas definições das migrations `002` e `250`.
