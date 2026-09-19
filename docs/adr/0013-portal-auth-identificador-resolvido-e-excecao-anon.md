# 0013 — Portal via Supabase Auth com identificador resolvido antes do login

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** CNPJ e senha entram pela Edge Function portal-login. portal_resolve_login é server-only; a allowlist anon e os identificadores descritos originalmente não são o contrato de frontend atual.
> Rastreabilidade: [ADR 0047](./0047-grants-de-funcao-fechados-por-padrao.md), [ADR 0048](./0048-confirmacao-de-email-do-portal-em-rota-publica.md), [ADR 0049](./0049-rate-limit-do-portal-chaveado-somente-por-cnpj.md); [migration ativa 002](../../supabase/migrations/002_business_logic_and_security.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-06-18

Supersede parcialmente:

- ADR 0001: o Portal não é mais exclusivamente email + senha na interface;
- ADR 0011: a allowlist `anon` não é mais vazia.

## Contexto

O Portal usa Supabase Auth e uma sessão isolada pelo cliente `supabasePortal`.
Para preservar o acesso por documento, a interface aceita CNPJ, CPF ou email.
Antes de `signInWithPassword`, documentos são resolvidos para o email técnico
da conta por `portal_resolve_login(text)`.

## Decisão

- Supabase Auth continua sendo o único mecanismo de sessão do Portal.
- CNPJ, CPF e email são identificadores de entrada; não são mecanismos de
  autenticação distintos.
- `portal_resolve_login(text)` é a única exceção pré-autenticação documentada
  ao default-deny de `anon`.
- A exceção deve permanecer limitada por hash do identificador, janela de
  tentativas, erro genérico e teste de migration.
- RPCs que retornam dados do cliente continuam exigindo usuário autenticado e
  escopo por `auth.uid()`.
- O fluxo antigo de senha própria em tabela e sessão por token não volta a ser
  aceito.

## Consequências

- A interface mantém conveniência sem reintroduzir uma segunda sessão.
- O email técnico pode ser resolvido internamente antes do login, aumentando a
  necessidade de rate limit e respostas não enumeráveis.
- Qualquer nova função pré-autenticação exige ADR ou atualização desta decisão,
  grant explícito e teste de segurança.
