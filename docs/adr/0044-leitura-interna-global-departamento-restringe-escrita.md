# 0044 — Leitura interna é global; departamento restringe escrita

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Leitura global permanece; a restrição geral de escrita por departamento foi substituída por escrita interna com rastro e exceções explícitas.
> Rastreabilidade: [ADR 0046](./0046-escrita-interna-global-com-rastro-obrigatorio.md); [migration ativa 002](../../supabase/migrations/002_business_logic_and_security.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: substituída pela ADR 0046 — 2026-08-13

## Contexto

`010_rls_by_role.sql` introduziu o modelo role-based e, no mesmo commit,
`014_lock_down_financial_reads_and_audit_writes.sql` restringiu o `SELECT` de
sete tabelas financeiras (`charge_tables`, `charge_table_items`,
`customer_rate_overrides`, `charge_calculations`, `invoices`, `invoice_items`,
`payments`) a `is_admin()`. `020`, `066` e `111` estenderam o mesmo padrão a
mais seis tabelas do ledger de faturamento. Naquele momento o modelo de papéis
era só admin/operator, e `is_admin()` cobria a única distinção que existia.

O modelo evoluiu para cinco perfis (`administrativo`, `financeiro`,
`operacoes`, `documentacao`, `equipamentos`) em `roleHasPermission()`
(`src/hooks/useAuth.tsx`), e `CONTEXT.md` já documentava a intenção —
"Visualização global interna", "Escopo de Documentação" — de que a divisão por
departamento é sobre o que cada perfil **altera**, não sobre o que enxerga. A
RLS financeira nunca foi revisitada: `is_admin()` continua reconhecendo só
`admin` e `administrativo`.

Isso foi descoberto ao investigar por que um usuário recém-criado com papel
Documentação não via a tabela de Taxas Locais — não era uma limitação
desenhada, era o resquício de 014 aplicado sobre um modelo de papéis que já
não existia mais. Auditoria completa em
`docs/archive/audits/2026-08-13-rbac-departamentos-visualizacao.md`.

RLS filtra linhas silenciosamente — devolve `200 []`, não um erro — então o
sintoma é indistinguível de "não há dado", o que atrasou a descoberta e
também esconde a regressão de testes que só verificam `error === null`.

## Decisão

A leitura de dados internos (todas as tabelas operacionais e financeiras) é
liberada para todo perfil interno **ativo**, via `is_active_read_user()`
(`211_equipamentos_rbac_hardening.sql`) — que inclui Equipamentos, ao
contrário de `is_active_user()`. Nenhum dado interno fica atrás de
`is_admin()` apenas por ser financeiro.

A restrição por departamento continua existindo, mas só no eixo de escrita:
`INSERT`/`UPDATE`/`DELETE` seguem exigindo `is_admin()` ou um helper de
permissão específico (`can_edit_voyages()`, `can_edit_customers()`,
`can_edit_local_charges()` — este último introduzido junto com esta ADR para
`charge_tables`/`charge_table_items`/`customer_rate_overrides`, alinhando-os à
permissão `charge_tables`/`charge_overrides` de `roleHasPermission`, que já
concedia essa capacidade a Documentação sem a RLS correspondente).

Migration: `291_financial_reads_by_department.sql`.

## Consequências

- **Positivas**: `can(permission)` no frontend volta a significar o que
  parece significar — controla edição, não visibilidade. Taxas Locais,
  Faturamento, Relatórios, Conciliação PIX e a aba Financeiro da Ficha do
  Cliente passam a funcionar para Financeiro, Operações, Documentação e
  Equipamentos, como o `CONTEXT.md` sempre descreveu.
- **Negativas / custos**: qualquer gate de UI que hoje usa uma permissão de
  escrita para decidir visibilidade (como `TaxasLocais.tsx` fazia) precisa ser
  revisado — visibilidade e edição agora podem, e devem, divergir.
- **Difícil de reverter**: voltar a restringir leitura financeira por role
  exigiria uma nova decisão explícita, já que o modelo atual trata isso como
  bug corrigido, não como comportamento intencional a preservar.

## Nota para novas policies

Leitura de dado interno usa `is_active_read_user()`, nunca `is_active_user()`
— a segunda exclui Equipamentos desde a migration 211.
