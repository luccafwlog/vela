# 0019 — Politica de senha e signup fechado

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Usuário interno é provisionado pelo admin via admin-users com senha definida; a exigência de provisionamento controlado e signup fechado permanece.
> Rastreabilidade: [ADR 0037](./0037-usuario-interno-criado-pelo-admin-com-senha-definida.md); [migration ativa 002](../../supabase/migrations/002_business_logic_and_security.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-07-07

## Contexto

O modelo de autorizacao do sistema trata usuarios autenticados como principals
provisionados. O Portal usa Supabase Auth, mas contas de clientes sao criadas
por administradores internos via Edge Function, e usuarios internos sao
provisionados pelo dashboard. Nao existe fluxo de cadastro publico no app.

O config versionado estava mais permissivo que a regra de UX do Portal: senha
minima de 6 caracteres, sem requisito de composicao, e signup aberto. Como o
cliente e apenas UX, a regra auditavel precisa estar no Supabase Auth.

## Decisao

- O piso de senha do Supabase Auth e 8 caracteres.
- Senhas novas devem conter letras minusculas, letras maiusculas e digitos
  (`lower_upper_letters_digits`).
- Self-signup fica desabilitado em todos os ambientes.
- Contas continuam sendo provisionadas pelos fluxos administrativos existentes:
  Edge Function para Portal e dashboard para usuarios internos.
- O dashboard de producao deve espelhar os valores versionados em
  `supabase/config.toml`.

## Consequencias

- Links de recuperacao do Portal passam a exigir a mesma composicao que o
  servidor exige.
- Usuarios existentes nao sao afetados ate trocarem a senha.
- Qualquer novo fluxo de cadastro publico precisa de nova ADR ou atualizacao
  explicita desta decisao.
- A verificacao operacional da postura de producao continua sendo uma acao de
  dashboard, nao algo que o repositorio consiga aplicar sozinho.
