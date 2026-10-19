import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Auditoria 2026-08-14, achado A-06. O Supabase concede EXECUTE a `anon` e
// `authenticated` em TODA função nova de `public` via ALTER DEFAULT PRIVILEGES,
// então o schema nasce aberto e a segurança depende de o autor lembrar do REVOKE.
// Foi essa causa que gerou as migrations corretivas 078, 088, 093, 152 e 257 — e
// a 152 varreu apenas funções SECURITY DEFINER, deixando as demais para trás.
// A 297 inverte o default (função nova nasce fechada) e limpa o resíduo.
describe('default-deny de grants em funções (migration 297)', () => {
  const read = (file: string) =>
    fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations', file), 'utf8')

  const migration = read('297_default_deny_function_grants.sql')

  // O cabeçalho descreve GRANTs em prosa (o estado herdado e o rollback). Só o SQL
  // executável conta para as travas de "não concede de volta".
  const sql = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

  describe('inversão do default', () => {
    it('revoga EXECUTE do default de funções para PUBLIC, anon e authenticated', () => {
      expect(sql).toMatch(
        /ALTER DEFAULT PRIVILEGES[\s\S]*IN SCHEMA public\s+REVOKE EXECUTE ON FUNCTIONS\s+FROM PUBLIC, anon, authenticated/,
      )
    })

    // Sem PUBLIC a inversão seria decorativa: o default embutido do PostgreSQL
    // concede EXECUTE a PUBLIC, e anon/authenticated herdam por serem membros.
    it('inclui PUBLIC — revogar só anon/authenticated não fecharia nada', () => {
      const alter = sql.match(/ALTER DEFAULT PRIVILEGES[\s\S]*?;/)?.[0] ?? ''
      expect(alter).toContain('PUBLIC')
    })

    // O default privilege é por role criadora. Todas as 252 funções de `public`
    // pertencem a `postgres`; amarrar ao role errado aplicaria a nada.
    it('amarra o default ao role que cria as funções do projeto', () => {
      expect(sql).toMatch(/FOR ROLE postgres/)
    })
  })

  describe('limpeza do resíduo já existente', () => {
    it('revoga PUBLIC e anon das funções de public', () => {
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon')
      expect(sql).toMatch(/nspname = 'public'/)
    })

    // Extensões (btree_gist, pg_trgm) vivem em public mas pertencem a
    // supabase_admin. Não são nossas e mexer no ACL delas está fora do escopo.
    it('limita a varredura às funções do projeto, poupando as de extensão', () => {
      expect(sql).toMatch(/proowner[\s\S]{0,80}postgres/)
    })

    // Mesma disciplina da 152 e da regra do playbook: trigger não é chamada por
    // RPC, então `authenticated` direto nelas é superfície sem uso.
    it('revoga authenticated apenas das funções de trigger', () => {
      expect(sql).toMatch(/prorettype = 'trigger'::regtype/)
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION %s FROM authenticated')
    })

    // Trava o achado do levantamento: nenhuma função depende de PUBLIC/anon para
    // o acesso do usuário logado — todas têm o grant de `authenticated` separado.
    // Se um REVOKE amplo de authenticated entrar aqui, o app inteiro cai.
    it('não revoga authenticated de forma ampla', () => {
      // Fora do ALTER DEFAULT PRIVILEGES, onde revogar `authenticated` é a própria
      // intenção (função FUTURA nasce fechada). Aqui a trava é sobre a varredura
      // das funções que JÁ existem: lá, só trigger pode perder `authenticated`.
      const varredura = sql.replace(/ALTER DEFAULT PRIVILEGES[\s\S]*?;/g, '')
      const revokes = varredura.match(/REVOKE[^;]*authenticated[^;]*/g) ?? []
      for (const revoke of revokes) {
        expect(revoke).toMatch(/%s FROM authenticated/)
      }
    })

    // O revoke em laço é silencioso: se o filtro deixar de casar, ele aplica zero
    // linhas e a migration passa dando a impressão de ter fechado o schema.
    it('falha em vez de virar no-op quando nada casa o filtro', () => {
      expect(sql).toMatch(/IF v_count = 0 THEN/)
      expect(sql).toMatch(/RAISE EXCEPTION/)
    })
  })

  describe('a exceção pré-autenticação da 297', () => {
    // Contrato histórico: na 297 portal_ship_schedule era vitrine pública por
    // decisão (auditoria A-02) e sobrevivia à varredura. A migration ativa 320
    // fechou essa exceção (ADR 0090).
    it('preserva e reafirma o anon de portal_ship_schedule', () => {
      expect(sql).toMatch(/proname <> 'portal_ship_schedule'/)
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.portal_ship_schedule\(\) TO anon/)
    })

    // A exceção anon da ADR 0013 morreu na migration 182, quando o login passou a
    // ser resolvido pela Edge Function `portal-login` com service_role. A 297 não
    // pode ressuscitá-la: o wrapper `portalResolveLogin` em src/ é código morto.
    it('não reconcede anon a portal_resolve_login', () => {
      expect(sql).not.toMatch(/GRANT[^;]*portal_resolve_login[^;]*anon/)
    })
  })

  describe('escopo', () => {
    it('é só de grants — não cria, substitui nem remove função', () => {
      expect(sql).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION/)
      expect(sql).not.toMatch(/DROP FUNCTION/)
    })

    it('não toca em policy nem em RLS', () => {
      expect(sql).not.toMatch(/CREATE POLICY|DROP POLICY|ROW LEVEL SECURITY/)
    })
  })
})
