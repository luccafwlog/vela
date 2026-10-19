# 0004 — Supabase RLS e RPCs como fronteira de segurança

> **Situação atual (2026-10-13).** Continua valendo a fronteira de segurança no banco: RLS em todas as tabelas e RPCs `SECURITY DEFINER` com `search_path` fixo.
> Não valem mais a leitura interna por `is_active_user()`, hoje `is_active_read_user()`, que inclui Equipamentos ([ADR 0044](./0044-leitura-interna-global-departamento-restringe-escrita.md)); o `is_admin()` como regra das escritas financeiras, porque a escrita interna é de todo Departamento ativo, com rastro, salvo as exceções da [ADR 0046](./0046-escrita-interna-global-com-rastro-obrigatorio.md); e o `anon` nas funções do Portal, porque nenhuma função é executável antes do login ([ADR 0090](./0090-programacao-de-navios-so-com-sessao.md)) e o default de `public` é fechado ([ADR 0047](./0047-grants-de-funcao-fechados-por-padrao.md)).
> `is_admin()` significa Administrativo desde a [ADR 0074](./0074-usuarios-retencao-e-backup-diario.md); a [ADR 0065](./0065-inbox-efeitos-e-autoridade-financeira.md) pôs no banco a autoridade do cálculo financeiro; as Edge Functions citadas abaixo não existem mais.
> Regra vigente em [Segurança](../operations/seguranca.md), seção "RLS-first".

> **Nota editorial — 2026-09-18 · estendida.** Leitura interna global, escrita com rastro, grants fechados por padrão e núcleos financeiros server-side refinam as permissões originais. Os exemplos de Edge Functions removidas são históricos.
> Rastreabilidade: [ADR 0044](./0044-leitura-interna-global-departamento-restringe-escrita.md), [ADR 0046](./0046-escrita-interna-global-com-rastro-obrigatorio.md), [ADR 0047](./0047-grants-de-funcao-fechados-por-padrao.md), [ADR 0065](./0065-inbox-efeitos-e-autoridade-financeira.md); [migration ativa 023](../../supabase/migrations/023_demurrage_calculation_snapshot.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-06-09

## Contexto

A aplicação roda no navegador e manipula dados sensíveis: clientes, documentos fiscais, invoices, PIX, tabelas de taxas, portal externo e operações destrutivas. Qualquer checagem feita apenas em React pode ser burlada por chamadas diretas ao Supabase.

O projeto também possui duas superfícies de autenticação: usuários internos via Supabase Auth + `user_profiles`, e clientes do portal via Supabase Auth em uma sessão isolada.

## Decisão

Adotar Supabase/Postgres como fronteira real de segurança, com RLS habilitado e operações críticas encapsuladas em RPCs `SECURITY DEFINER`.

- Helpers de banco como `current_user_role()`, `is_active_user()` e `is_admin()` são a base das policies.
- Leituras e escritas operacionais usam `is_active_user()` quando a equipe interna pode operar o dado.
- Escritas financeiras, administração e deletes sensíveis exigem `is_admin()` ou RPCs com validações explícitas.
- Funções `SECURITY DEFINER` devem ter `search_path` controlado, grants mínimos e validação de `auth.uid()`/role quando expostas a usuários autenticados.
- A role `anon` só deve executar funções pensadas para o Portal do Cliente ou fluxos públicos necessários; funções internas não devem ficar expostas a `anon`.
- Edge Functions que usam service role (`provision-portal-user`, `notify-invoice-issued`) devem validar chamador/origem/segredo antes de executar privilégios administrativos.

## Consequências

- **Positivas**: o app pode esconder botões por UX sem depender disso para segurança; fluxos financeiros ficam transacionais; dados do portal ficam escopados ao cliente autenticado.
- **Negativas / custos**: mudanças de schema exigem migration cuidadosa; algumas leituras úteis para UI precisam de RPC para atravessar RLS com escopo seguro; migrations precisam ser aplicadas no Supabase antes do deploy do código dependente.
- **Difícil de reverter**: mover autorização de volta para o cliente aumentaria a superfície de vazamento e quebraria a premissa de produção do sistema.
