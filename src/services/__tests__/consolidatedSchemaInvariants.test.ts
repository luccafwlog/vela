import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// Por que este arquivo existe.
//
// Depois do squash (ADR 0062) `src/test/setup.ts` serve a UNIÃO do diretório
// ativo (`supabase/migrations/`, primeiro) com o arquivo morto
// (`supabase/migrations_archive/`), para que os 201 testes de contrato das
// migrations históricas continuem passando sem serem reescritos — e os
// invariantes de futuro continuem enxergando o schema ativo. Os 6 testes de
// contrato pontual histórico vivem escopados ao arquivo morto.
//
// Este arquivo é a contrapartida direta. Ele usa `vi.importActual` para
// escapar do mock e ler o diretório real, e trava no schema ATIVO as
// invariantes que a suíte histórica costumava garantir sobre a cadeia inteira.
async function realFs() {
  return vi.importActual<typeof import('node:fs')>('node:fs')
}

const MIGRATIONS = path.resolve(process.cwd(), 'supabase/migrations')

async function lerMigrationsAtivas(): Promise<Map<string, string>> {
  const fs = await realFs()
  const nomes = fs
    .readdirSync(MIGRATIONS)
    .filter((nome) => nome.endsWith('.sql'))
    .sort()
  return new Map(nomes.map((nome) => [nome, fs.readFileSync(path.join(MIGRATIONS, nome), 'utf8')]))
}

describe('schema consolidado v1.0 (arquivos realmente aplicados)', () => {
  it('o harness de arquivo morto não escondeu o diretório ativo', async () => {
    const ativas = await lerMigrationsAtivas()
    const nomes = [...ativas.keys()]
    const fs = await realFs()
    const nomesNoDisco = fs
      .readdirSync(MIGRATIONS)
      .filter((nome) => nome.endsWith('.sql'))
      .sort()

    // A lista esperada vem do diretório ativo real, não de um limite arbitrário
    // que poderia deixar uma migration ausente passar silenciosamente.
    expect(nomes).toEqual(nomesNoDisco)
    expect(nomes).toContain('001_initial_schema.sql')
    expect(nomes).toContain('002_business_logic_and_security.sql')
    for (const nome of nomes) {
      expect(nome).toMatch(/^\d{3}_[a-z0-9_]+\.sql$/)
    }
    // ADR 0016 no diretório ativo: ordem lexicográfica = ordem de aplicação
    // exige prefixos únicos — um futuro 005 duplicado falha aqui, não no push.
    const prefixos = nomes.map((nome) => nome.split('_')[0])
    expect(new Set(prefixos).size).toBe(prefixos.length)
  })

  it('fecha os defaults de EXECUTE de public antes de criar qualquer objeto (ADR 0047)', async () => {
    const ativas = await lerMigrationsAtivas()
    const estrutura = ativas.get('001_initial_schema.sql')
    expect(estrutura).toBeDefined()

    // O Supabase concede EXECUTE a anon/authenticated em toda função nova de
    // `public` por ALTER DEFAULT PRIVILEGES próprio. Esse default vive em
    // pg_default_acl, fora do schema, e não sai em pg_dump: sem inverter isso
    // aqui, um banco novo nasce mais aberto do que produção.
    const fechamento = estrutura!.match(
      /ALTER\s+DEFAULT\s+PRIVILEGES\s+FOR\s+ROLE\s+postgres\s+REVOKE\s+EXECUTE\s+ON\s+FUNCTIONS\s+FROM\s+[^;]*PUBLIC[^;]*\banon\b[^;]*;/is,
    )
    expect(fechamento).not.toBeNull()

    const primeiroCreate = estrutura!.search(/^CREATE\s+(TABLE|SEQUENCE)\s/im)
    expect(primeiroCreate).toBeGreaterThan(-1)
    // Default privilege só vale na criação: depois do primeiro CREATE não adianta.
    expect(fechamento!.index).toBeLessThan(primeiroCreate)
  })

  it('anon só recebe EXECUTE na vitrine pública de programação de navios', async () => {
    const ativas = await lerMigrationsAtivas()
    const concessoesAnon: string[] = []
    const concessoesPublic: string[] = []
    for (const sql of ativas.values()) {
      for (const match of sql.matchAll(
        /GRANT\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+([^;]+?)\s+TO\s+([^;]+);/gi,
      )) {
        if (/\banon\b/i.test(match[2])) concessoesAnon.push(match[1].trim())
        // `anon` herda de PUBLIC: um GRANT TO PUBLIC abre anon sem citar o nome.
        if (/(?:^|,)\s*PUBLIC\s*(?:,|;|$)/i.test(match[2])) concessoesPublic.push(match[1].trim())
      }
    }
    // ADR 0013 / achado A-02: portal_ship_schedule é a única exceção viva.
    expect(concessoesAnon).toEqual(['public.portal_ship_schedule()'])
    expect(concessoesPublic).toEqual([])
  })

  it('nenhuma tabela ou sequência é concedida a anon ou a PUBLIC', async () => {
    const ativas = await lerMigrationsAtivas()
    const vazamentos: string[] = []
    for (const sql of ativas.values()) {
      for (const match of sql.matchAll(
        // `(?:ALL\s+)?` + plural cobrem `GRANT ... ON ALL TABLES ...` — sem
        // eles, um futuro grant amplo a anon/PUBLIC passaria na exata
        // regressão que este teste existe para travar (o único ON ALL do
        // histórico é o grant a `authenticated` no arquivo morto 002_rls.sql).
        /GRANT\s+[A-Z, ]+\s+ON\s+(?:ALL\s+)?(?:TABLES?|SEQUENCES?)\s+[^;]+?\s+TO\s+([^;]+);/gi,
      )) {
        if (/\b(?:anon|PUBLIC)\b/i.test(match[1])) vazamentos.push(match[0])
      }
    }
    expect(vazamentos).toEqual([])
  })

  it('toda tabela criada tem RLS habilitada', async () => {
    const ativas = await lerMigrationsAtivas()
    const tudo = [...ativas.values()].join('\n')
    const tabelas = new Set(
      [...tudo.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?public\.([a-z0-9_]+)/gi)].map((m) => m[1]),
    )
    const comRls = new Set(
      [...tudo.matchAll(/ALTER TABLE (?:ONLY )?public\.([a-z0-9_]+) ENABLE ROW LEVEL SECURITY/gi)].map(
        (m) => m[1],
      ),
    )
    expect(tabelas.size).toBeGreaterThan(100)
    expect([...tabelas].filter((t) => !comRls.has(t))).toEqual([])
  })

  it('toda função SECURITY DEFINER fixa o search_path', async () => {
    const ativas = await lerMigrationsAtivas()
    const semSearchPath: string[] = []
    for (const sql of ativas.values()) {
      for (const match of sql.matchAll(
        /CREATE (?:OR REPLACE )?FUNCTION (public\.[a-z0-9_]+)\([\s\S]*?RETURNS[\s\S]*?AS \$/gi,
      )) {
        const cabecalho = match[0]
        if (/SECURITY\s+DEFINER/i.test(cabecalho) && !/SET\s+search_path/i.test(cabecalho)) {
          semSearchPath.push(match[1])
        }
      }
    }
    expect(semSearchPath).toEqual([])
  })

  it('RPC delete_baplie_manifest_for_voyage possui grant explícito para authenticated e service_role', async () => {
    const ativas = await lerMigrationsAtivas()
    const tudo = [...ativas.values()].join('\n')
    const match = tudo.match(
      /GRANT\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+public\.delete_baplie_manifest_for_voyage\b[^;]*?\bTO\s+([^;]+);/i,
    )
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(/\bauthenticated\b/)
    expect(match![1]).toMatch(/\bservice_role\b/)
  })

  it('S01 fecha o helper de trigger e antecipa guardas de entrada (009)', async () => {
    const ativas = await lerMigrationsAtivas()
    expect([...ativas.keys()]).toContain('009_rpc_entry_security.sql')
    const tudo = [...ativas.values()].join('\n')

    // #659.2: sem GRANT explícito o helper herda EXECUTE no catálogo real;
    // o REVOKE nominal fecha PUBLIC/anon/authenticated e nada o reabre.
    expect(tudo).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.upsert_portal_invoice_exception\s*\(\s*bigint\s*,\s*text\s*\)\s+FROM\s+[^;]*PUBLIC[^;]*\banon\b[^;]*\bauthenticated\b[^;]*;/i,
    )
    expect(tudo).not.toMatch(
      /GRANT\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+public\.upsert_portal_invoice_exception\b[^;]*?\bTO\s+[^;]*(?:\banon\b|PUBLIC|authenticated)/i,
    )

    // Definição final = última reemissão no diretório ativo (a 009 vence a 002).
    const definicaoFinal = (nome: string) => {
      const ocorrencias = [...tudo.matchAll(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nome}\\([\\s\\S]*?\\$\\$;`, 'gi'),
      )]
      return ocorrencias[ocorrencias.length - 1]?.[0] ?? ''
    }

    // #660.1: overview resolve identidade/revogação pelo helper antes do UPDATE.
    const overview = definicaoFinal('portal_get_session_overview_v2')
    expect(overview).toContain('PERFORM public.current_portal_customer_id();')
    expect(overview.indexOf('PERFORM public.current_portal_customer_id();')).toBeLessThan(
      overview.indexOf('last_login_at = now()'),
    )

    // #660.3: guarda de import (ator = chamador) antes de ler payload/delegar.
    const blImport = definicaoFinal('import_bl_freight_transactional')
    expect(blImport.indexOf('p_changed_by IS DISTINCT FROM auth.uid()')).toBeGreaterThan(-1)
    expect(blImport.indexOf('p_changed_by IS DISTINCT FROM auth.uid()')).toBeLessThan(
      blImport.indexOf('jsonb_array_elements'),
    )

    // #660.3: permissão do núcleo de escala antes de delegar ao corpo que
    // cria/reutiliza o porto. A migration 049 envolve esse corpo para garantir
    // que o snapshot POD seja salvo na mesma transação.
    const escala = definicaoFinal('save_voyage_escala_terminal_state_v2')
    expect(escala).toContain('Usuario ativo sem permissao para editar a escala.')
    expect(escala.indexOf('Usuario ativo sem permissao para editar a escala.')).toBeLessThan(
      escala.indexOf('public.save_voyage_escala_terminal_state_v2_legacy_049'),
    )
  })
})
