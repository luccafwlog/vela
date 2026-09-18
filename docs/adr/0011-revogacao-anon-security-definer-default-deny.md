# ADR 0011 — Revogação total de `anon` em funções SECURITY DEFINER (default-deny)

**Data:** 2026-06-09 · **Status:** aceito

Supersedida parcialmente pela ADR 0013: `portal_resolve_login(text)` é a exceção
pré-autenticação explícita e limitada para `anon`.

## Contexto

A auditoria técnica de 2026-06-09 (`docs/TECHNICAL-AUDIT-2026-06-09.md`, F5) apontou
24 funções `SECURITY DEFINER` executáveis pela role `anon` no banco de produção,
incluindo funções de trigger e funções internas de faturamento. O Supabase concede
`EXECUTE` a `anon`/`authenticated`/`service_role` via default privileges na criação
de cada função, então cada função nova reabria a brecha mesmo após migrations de
revogação anteriores (`20260530102907`, `20260608192000`).

Historicamente o portal do cliente justificava um allowlist `anon` (fluxo de token
legado, pré-autenticação). Desde o rework `20260603130350`, o portal usa Supabase
Auth completo (`signInWithPassword` em `usePortalAuth.tsx`) e todas as funções
`portal_*` de dados validam a sessão via `current_portal_customer_id()`, que exige
`auth.uid()` válido. Não existe mais nenhuma chamada de RPC pré-autenticação no
frontend — verificado por grep de call sites em `src/`.

## Decisão

1. **Allowlist `anon` vazio.** A migration `20260609210000` revoga `EXECUTE` de
   `PUBLIC` e `anon` em **todas** as funções `SECURITY DEFINER` do schema `public`,
   sem exceção de portal.
2. **Funções de trigger** (`RETURNS trigger`) também perdem `EXECUTE` de
   `authenticated`: triggers executam com privilégio do owner; nenhum caller
   precisa invocá-las via RPC.
3. **Default-deny na criação:** toda migration que criar função `SECURITY DEFINER`
   deve incluir, no mesmo arquivo,
   `REVOKE EXECUTE ON FUNCTION public.<fn>(<args>) FROM PUBLIC, anon;`
   (e de `authenticated`, se for trigger). Regra incorporada ao playbook
   seção de migrations do `WORKFLOW.md`.

## Consequências

- Security advisor: 0 avisos `anon_security_definer_function_executable`.
- Portal e app interno inalterados (ambos operam como `authenticated`;
  `service_role` mantém os grants explícitos).
- As funções do fluxo de token legado (`portal_login(text,text)`,
  `portal_logout(text)`, `portal_get_session_overview(text)`,
  `resolve_customer_portal_session(text)`, `portal_check_auth_method(text)`)
  ficaram sem caller conhecido — candidatas a remoção em migration futura.
- Se algum fluxo pré-autenticação voltar a existir, o grant a `anon` deve ser
  explícito, pontual e documentado neste ADR (atualizando o status do allowlist).
