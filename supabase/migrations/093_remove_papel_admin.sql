-- Migration 093: o papel legado `admin` deixa de existir (ADR 0074, item 2;
-- plano docs/plans/2026-09-24-politica-de-exclusao.md, Fase 6).
--
-- O app já tratava `admin` como Administrativo (src/hooks/useAuth.tsx) e
-- is_admin() aceita os dois. Esta migration passa todo perfil `admin` a
-- `administrativo` e tira o valor da lista de papéis aceitos, para acabar com a
-- dúvida Admin × Administrativo.
--
-- Esta migration reescreve linhas existentes (user_profiles.role). Ela se
-- apoia na linha "Data status" do AGENTS.md: a base de produção só tem
-- fixtures descartáveis. A troca preserva o poder de cada usuário, porque
-- is_admin() já tratava os dois papéis como iguais; o trigger de auditoria de
-- user_profiles registra a mudança.
--
-- ponytail: 22 funções e 2 policies ainda citam 'admin' ao lado de
-- 'administrativo' em listas de papéis. Com nenhum perfil podendo ter o
-- valor, esses literais são inertes. Upgrade: removê-los quando cada função
-- for reescrita por outro motivo.

UPDATE public.user_profiles SET role = 'administrativo' WHERE role = 'admin';

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role = ANY (ARRAY['operator', 'administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos']));
