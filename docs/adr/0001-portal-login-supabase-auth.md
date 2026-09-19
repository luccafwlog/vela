# 0001 — Login do Portal do Cliente via Supabase Auth (email + senha)

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Login atual pede CNPJ e senha; portal-login resolve a identidade no servidor. Não restaurar email-only nem acesso anon ao resolver.
> Rastreabilidade: [ADR 0013](./0013-portal-auth-identificador-resolvido-e-excecao-anon.md), [ADR 0047](./0047-grants-de-funcao-fechados-por-padrao.md); [migration ativa 002](../../supabase/migrations/002_business_logic_and_security.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-06-03 · **parcialmente superado** (ver nota)

> **Nota (2026-06-18):** a decisão de adotar **email-only** foi parcialmente revertida. O login por **CNPJ** foi reintroduzido sobre Supabase Auth: o documento (CNPJ/CPF) é resolvido para o email via RPC `portal_resolve_login` e a autenticação final continua sendo `signInWithPassword`. Naquele estágio o portal aceitava **CNPJ ou email**; o contrato atual está na nota de 2026-09-18. O que se manteve do ADR é o fim do token legado em `sessionStorage` (auth é 100% Supabase Auth). Fonte de verdade: [modules/portal-cliente.md](../modules/portal-cliente.md) e [operations/seguranca.md](../operations/seguranca.md).

Supersedida parcialmente pela ADR 0013 quanto ao identificador aceito na tela
de login. Supabase Auth continua sendo o mecanismo de autenticação e sessão.

## Contexto

O Portal do Cliente nasceu com dois caminhos de autenticação coexistindo:

- **Legado**: Conta de Portal identificada por **CNPJ + senha** (`portal_login`, `password_hash`), com sessão por token em `sessionStorage`.
- **Supabase Auth**: Conta vinculada a um usuário `auth.users` (`auth_user_id` + `portal_email`), login por **email + senha**, sessão gerida pelo próprio Supabase.

Na prática, o login era sempre chaveado por CNPJ (`usePortalAuth.signIn` → `portal_check_auth_method(p_cnpj_cpf)`), mesmo para contas Supabase Auth — o CNPJ servia só para descobrir o email. O provisionamento (`upsert_customer_portal_account`, chamado pela ficha do cliente) criava **apenas** contas legadas, apesar de a UI pedir "Email de contato + Senha". A Edge Function `provision-portal-user` (que cria o usuário Auth de verdade) existia no repositório mas **não estava deployada nem conectada** ao front.

Resultado: o cliente precisava logar por CNPJ embora o admin tivesse cadastrado email + senha — uma incoerência entre o modelo mental e a implementação. Havia exatamente uma Conta de Portal em produção, legada.

## Decisão

Adotar **email + senha via Supabase Auth como o único modelo de autenticação** do Portal do Cliente, abandonando o caminho legado por CNPJ.

- A tela de login passa a pedir email + senha e autentica direto em `supabase.auth.signInWithPassword`; o overview da sessão é resolvido por `auth.uid()` (`portal_get_session_overview_v2`).
- O provisionamento passa a criar/atualizar o usuário Supabase Auth: a Edge Function `provision-portal-user` é deployada e conectada à ficha do cliente.
- A única conta legada existente é descartada (não há migração de dados a preservar).
- O caminho legado (CNPJ, `password_hash`, token em `sessionStorage`) é removido do fluxo de login.

## Consequências

- **Positivas**: um só modelo de auth (menos código, menos superfície de manutenção e de XSS); login coerente com o que o admin cadastra; sessão e reset de senha apoiados na infra do Supabase.
- **Negativas / custos**: depende de uma Edge Function deployada com `SUPABASE_SERVICE_ROLE_KEY` e `APP_URL` configuradas; provisionar uma conta deixa de ser uma única chamada RPC (cria a linha da conta e então invoca a function).
- **Difícil de reverter**: remove o `password_hash`/token legado e apaga a conta existente. Reintroduzir o login por CNPJ exigiria restaurar todo o caminho legado.
