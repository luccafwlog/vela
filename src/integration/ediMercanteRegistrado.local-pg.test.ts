import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// Migration 600 (decisão do dono de 2026-11-06, ADR 0129): Baixar arquivo do
// EDI Mercante grava o arquivo no Histórico da Viagem com um número
// sequencial do Vela, e só a conta Dev gera.

const w = financeWorld(9599)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT to_regproc('public.register_mercante_edi_file') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}, 'migration 600 aplicada')

type Registered = { number: number; file_name: string }

const call = (args: string) => `SELECT public.register_mercante_edi_file(${args})`
const valid = (voyageId: number, mode = 'container') => `${voyageId}, 'cntac', 'BRVIX', '${mode}', 'gg6', 3, 12`

function setDev(isDev: boolean) {
  w.psql(`UPDATE public.user_profiles SET is_dev = ${isDev} WHERE id = '${w.actors.administrativo}'`)
}

function cleanupFiles() {
  w.psql(`DELETE FROM public.mercante_edi_files WHERE voyage_id = ${w.voyageId}`)
}

describeLocal('600 — EDI Mercante registrado com número próprio', () => {
  beforeAll(() => {
    cleanupFiles()
    w.setup()
  })
  afterAll(() => {
    cleanupFiles()
    w.cleanup()
  })

  it('a conta Dev registra o arquivo: número sequencial, nome com 6 dígitos e a sigla, rota e natureza gravadas', () => {
    setDev(true)
    const first = w.json<Registered>('administrativo', call(valid(w.voyageId)))
    const second = w.json<Registered>('administrativo', call(valid(w.voyageId, 'vazio')))

    expect(second.number).toBe(first.number + 1)
    expect(first.file_name).toBe(`FWL_MERCANTE_${String(first.number).padStart(6, '0')}_GG6.TXT`)
    expect(w.psql(`SELECT string_agg(concat_ws(':', pol, pod, cargo_mode, bl_count, item_count, generated_by), ',' ORDER BY number)
      FROM public.mercante_edi_files WHERE voyage_id = ${w.voyageId}`))
      .toBe([
        `CNTAC:BRVIX:container:3:12:${w.actors.administrativo}`,
        `CNTAC:BRVIX:vazio:3:12:${w.actors.administrativo}`,
      ].join(','))
    // O usuário interno lê o registro (Histórico da Viagem).
    expect(w.asOk('financeiro', `SELECT count(*) FROM public.mercante_edi_files WHERE voyage_id = ${w.voyageId}`)).toBe('2')
  })

  it('recusa quem não é Dev, a Viagem cancelada e a natureza inválida, sem gravar', () => {
    const before = w.psql(`SELECT count(*) FROM public.mercante_edi_files WHERE voyage_id = ${w.voyageId}`)

    setDev(false)
    const notDev = w.as('administrativo', call(valid(w.voyageId)))
    expect(notDev.status).not.toBe(0)
    expect(notDev.stderr).toContain('só da conta Dev')

    setDev(true)
    const wrongMode = w.as('administrativo', call(valid(w.voyageId, 'granel')))
    expect(wrongMode.stderr).toContain('Natureza do EDI Mercante inválida')

    w.psql(`SET session_replication_role = replica; UPDATE public.voyages SET status = 'cancelled' WHERE id = ${w.voyageId}; SET session_replication_role = origin`)
    const cancelled = w.as('administrativo', call(valid(w.voyageId)))
    expect(cancelled.stderr).toContain('Viagem cancelada não gera EDI Mercante')
    w.psql(`SET session_replication_role = replica; UPDATE public.voyages SET status = 'active' WHERE id = ${w.voyageId}; SET session_replication_role = origin`)

    expect(w.psql(`SELECT count(*) FROM public.mercante_edi_files WHERE voyage_id = ${w.voyageId}`)).toBe(before)
  })

  it('a tabela não aceita escrita direta do usuário autenticado', () => {
    const direct = w.as('administrativo', `INSERT INTO public.mercante_edi_files (voyage_id, pol, pod, cargo_mode, file_name, bl_count, item_count, generated_by)
      VALUES (${w.voyageId}, 'CNTAC', 'BRVIX', 'container', 'X.TXT', 0, 0, '${w.actors.administrativo}')`)
    expect(direct.status).not.toBe(0)
    expect(direct.stderr).toContain('permission denied')
  })

  // Por último: a Viagem é excluída aqui. Achado da revisão da PR #1240.
  it('Excluir viagem com EDI registrado leva o registro junto, como a prévia diz', () => {
    setDev(true)
    w.json<Registered>('administrativo', call(valid(w.voyageId)))
    const preview = w.json<{ items: Array<{ table: string; action: string; count: number }> }>('administrativo',
      `SELECT public.voyage_delete_preview(${w.voyageId})`)
    expect(preview.items).toContainEqual(expect.objectContaining({ table: 'mercante_edi_files', action: 'delete' }))

    w.asOk('administrativo', `SELECT public.delete_records('voyage', ARRAY['${w.voyageId}']::text[], false, 'Excluída no teste 600')`)
    expect(w.psql(`SELECT count(*) FROM public.voyages WHERE id = ${w.voyageId}`)).toBe('0')
    expect(w.psql(`SELECT count(*) FROM public.mercante_edi_files WHERE voyage_id = ${w.voyageId}`)).toBe('0')
  })
})
