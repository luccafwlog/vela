# Remediação da fronteira de segurança do Portal — Plano de implementação

> **Para agentes executores:** usar `superpowers:executing-plans` para executar este plano tarefa por tarefa, com TDD e revisão integral ao final.

**Objetivo:** eliminar os cinco achados da auditoria AppSec de 2026-09-20 sem alterar o contrato funcional legítimo do Portal ou da aplicação interna.

**Arquitetura:** uma migration aditiva substitui as RPCs vulneráveis, mantendo assinaturas e ACLs explícitas. As Edge Functions extraem pequenas funções testáveis para equalizar o caminho de autenticação e ordenar a redefinição de senha em modo fail-closed. Os filtros PostgREST reutilizam o sanitizador central existente.

**Stack:** PostgreSQL 16/Supabase, Edge Functions Deno/TypeScript, React/TypeScript e Vitest.

**Spec:** solicitação de remediação da auditoria AppSec nesta tarefa; contratos canônicos em `docs/operations/seguranca.md`, ADR 0011 e ADR 0047.

**Revisão final:** o parecer independente identificou que a folga histórica de
cinco segundos em `current_portal_customer_id()` ainda admitia um JWT obtido
concorrentemente com a senha antiga. A migration `068` substitui o
corte por comparação estrita; o teste local cobre token imediatamente anterior
e posterior ao marco de revogação.

## Restrições globais

- Preservar os dois clientes Supabase e a resolução de tenant no banco.
- Manter apenas `portal_ship_schedule()` executável por `anon`.
- Toda RPC `SECURITY DEFINER` deve fixar `search_path` e ter ACL explícita.
- Alterações em migrations existentes são proibidas; a correção entra em migration aditiva.
- A redefinição de senha deve invalidar sessões antes da alteração e novamente após ela.
- A resposta de login não pode distinguir CNPJ elegível por mensagem, status ou quantidade de chamadas ao Auth.

## Foco da revisão

- Usuário Portal autenticado sem `user_profiles` deve receber `42501` nas cinco RPCs internas.
- A resposta JSON de faturas não pode ganhar colunas internas quando a tabela evoluir.
- Falha na revogação inicial deve impedir a alteração da senha.
- CNPJ inexistente deve percorrer o mesmo lookup de usuário e tentativa de senha que CNPJ existente.
- `%`, `_`, vírgulas e parênteses em filtros de comunicação devem permanecer texto literal.

---

### Task 1: Fechar RPCs internas e minimizar projeções do Portal

**Arquivos:**
- Criar: `supabase/migrations/067_portal_security_boundary_remediation.sql`
- Modificar: `src/integration/portalInspectionParity.local-pg.test.ts`
- Modificar: `src/components/portal/PortalDemurrageDetailModal.tsx`
- Modificar: `src/pages/__tests__/PortalBilling.test.tsx`
- Modificar: `docs/operations/seguranca.md`

**Interfaces:**
- Consome: `_portal_actor_role()`, wrappers públicos do Portal e assinaturas atuais das RPCs.
- Produz: mesmas assinaturas públicas com guards NULL-safe e JSON allowlisted; a UI exibe somente o ROE aplicado, sem decompor o markup.

- [ ] Adicionar testes locais que chamem as cinco RPCs como usuário Portal e esperem `42501`.
- [ ] Adicionar testes locais que consultem detalhes próprios e rejeitem as chaves internas auditadas.
- [ ] Executar os testes contra o schema anterior e observar falha pelos dois comportamentos vulneráveis.
- [ ] Criar a migration com `IS DISTINCT FROM`/guarda explícita de `NULL`, projeções `jsonb_build_object`, `search_path` e grants fechados.
- [ ] Recriar o Postgres local, executar os testes e confirmar aprovação.
- [ ] Atualizar o contrato operacional de segurança e fazer commit.

### Task 2: Tornar a redefinição de senha fail-closed

**Arquivos:**
- Criar: `supabase/functions/_shared/portalPasswordResetFlow.ts`
- Criar: `src/services/__tests__/portalPasswordResetFlow.test.ts`
- Modificar: `supabase/functions/portal-password-reset/index.ts`

**Interfaces:**
- Consome: `revokePortalSessions(userId)` e atualização administrativa da senha.
- Produz: `resetPortalPasswordFailClosed(userId, dependencies)`.

- [ ] Escrever testes de comportamento para ordem revogar → quarentena → alterar → revogar e para falhas antes/depois da alteração.
- [ ] Executar e observar falha por módulo ausente.
- [ ] Implementar o orquestrador e integrá-lo à Edge Function.
- [ ] Executar testes focados e fazer commit.

### Task 3: Equalizar o caminho de login contra enumeração

**Arquivos:**
- Criar: `supabase/functions/_shared/portalLoginIdentity.ts`
- Criar: `src/services/__tests__/portalLoginIdentity.test.ts`
- Modificar: `supabase/functions/portal-login/index.ts`
- Modificar: `docs/operations/seguranca.md`

**Interfaces:**
- Consome: conta consultada por CNPJ e `PORTAL_LOGIN_DUMMY_AUTH_USER_ID`.
- Produz: `resolvePortalLoginIdentity(account, dummyUserId, lookupUser)` com exatamente um lookup para ambos os casos.

- [ ] Escrever teste que prova lookup e tentativa de autenticação equivalentes para conta elegível e inexistente.
- [ ] Executar e observar falha por módulo ausente.
- [ ] Implementar seleção da identidade real/dummy e remover o retorno antecipado pré-Auth.
- [ ] Documentar a identidade dummy server-only, executar testes focados e fazer commit.

### Task 4: Neutralizar curingas nos filtros de comunicação e concluir

**Arquivos:**
- Modificar: `src/services/customerCommunications.ts`
- Modificar: `src/services/__tests__/customerCommunicationsCoverage.test.ts`
- Modificar: `src/services/__tests__/customerCommunications.test.ts`
- Modificar: `docs/CHANGELOG.md`
- Mover ao concluir: este plano para `docs/archive/plans/`

**Interfaces:**
- Consome: `sanitizeLikeTerm(value)` de `src/lib/utils.ts`.
- Produz: padrões `.ilike()` com curingas do usuário escapados.

- [ ] Escrever testes que esperem `%` e `_` escapados nos dois filtros.
- [ ] Executar e observar a falha com os termos crus.
- [ ] Aplicar `sanitizeLikeTerm` antes de construir os padrões.
- [ ] Executar a suíte focada e fazer commit.
- [ ] Arquivar o plano, atualizar changelog/índices e executar todos os gates obrigatórios.
- [ ] Solicitar revisão integral independente, corrigir achados importantes, criar a PR e acompanhar a CI até ficar verde.
