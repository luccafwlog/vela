import { beforeEach, expect, it, vi } from 'vitest'

// ADR 0092, item 5: o recadastro dos vazios que falhou fica retomável em
// /baplie. A pendência é o manifesto de vazios do Baplie com containers ou
// rotas diferentes dos vazios do Baplie gravado.
const tables = vi.hoisted(() => ({
  baplie_containers: [] as Array<Record<string, unknown>>,
  vazios_importacao_containers: [] as Array<Record<string, unknown>>,
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: keyof typeof tables) => ({
      select: () => ({
        eq: () => ({ order: () => ({ range: () => Promise.resolve({ data: tables[table], error: null }) }) }),
      }),
    }),
  },
}))
vi.mock('../baplieReconciliation', () => ({ applyBapliePhysicalFlagsDetailed: vi.fn() }))
const planilha = vi.hoisted(() => ({ rows: [] as Array<{ container_number: string; pol: string | null; pod: string | null; source: 'manual' | 'baplie' }> }))
vi.mock('../vaziosImportacaoImport', async (importOriginal) => ({
  vaziosContainerKey: (await importOriginal<typeof import('../vaziosImportacaoImport')>()).vaziosContainerKey,
  getBaplieManifestForVoyage: vi.fn(),
  replaceVaziosFromBaplie: vi.fn(),
  listVoyageVaziosImportacao: vi.fn(() => Promise.resolve(planilha.rows)),
}))

import { baplieVaziosNaPlanilha, hasPendingBaplieVazios } from '../baplieImport'

const staged = (container_number: string, status: 'empty' | 'full', pod = 'BRVIX') => ({ container_number, status, pol: 'CNTAC', pod })
const registered = (container_number: string, pod = 'BRVIX') => ({ container_number, pol: 'CNTAC', pod })

beforeEach(() => { planilha.rows = [] })

it('mesmos vazios (em qualquer ordem, cheios fora): sem pendência', async () => {
  tables.baplie_containers = [staged('EMPU0000002', 'empty'), staged('FULU0000001', 'full'), staged('EMPU0000001', 'empty')]
  tables.vazios_importacao_containers = [registered('EMPU0000001'), registered('EMPU0000002')]
  expect(await hasPendingBaplieVazios(7, 'vm-1')).toBe(false)
})

it('mesma quantidade com outro container ou outra rota: pendente', async () => {
  tables.baplie_containers = [staged('EMPU0000001', 'empty'), staged('EMPU0000003', 'empty')]
  tables.vazios_importacao_containers = [registered('EMPU0000001'), registered('EMPU0000002')]
  expect(await hasPendingBaplieVazios(7, 'vm-1')).toBe(true)

  tables.baplie_containers = [staged('EMPU0000001', 'empty', 'BRSSZ')]
  tables.vazios_importacao_containers = [registered('EMPU0000001')]
  expect(await hasPendingBaplieVazios(7, 'vm-1')).toBe(true)
})

// ADR 0095, decisão 21 (migration 398): o vazio que a planilha trouxe fica com
// ela e não entra no manifesto do Baplie; não é pendência.
it('vazio do Baplie que a planilha trouxe (mesmo em outra rota): sem pendência', async () => {
  tables.baplie_containers = [staged('EMPU0000001', 'empty'), staged('EMPU0000002', 'empty', 'BRSSZ')]
  tables.vazios_importacao_containers = [registered('EMPU0000001')]
  planilha.rows = [{ container_number: 'EMPU0000002', pol: 'CNTAC', pod: 'BRPNG', source: 'manual' }]
  expect(await hasPendingBaplieVazios(7, 'vm-1')).toBe(false)

  planilha.rows = []
  expect(await hasPendingBaplieVazios(7, 'vm-1')).toBe(true)
})

it('baplieVaziosNaPlanilha: conta o que o Baplie cadastra e mostra a rota que difere', () => {
  const result = baplieVaziosNaPlanilha(
    [staged('EMPU0000001', 'empty'), staged('EMPU0000002', 'empty', 'BRSSZ'), staged('EMPU0000003', 'empty'), staged('FULU0000001', 'full')],
    [
      { container_number: 'EMPU0000001', pol: 'CNTAC', pod: 'BRVIX', source: 'manual' },
      { container_number: 'empu 0000002', pol: 'CNTAC', pod: 'BRPNG', source: 'manual' },
      // O próprio Baplie gravado não conta como planilha.
      { container_number: 'EMPU0000003', pol: 'CNTAC', pod: 'BRVIX', source: 'baplie' },
    ],
  )
  expect(result).toEqual({
    aCadastrar: 1,
    naPlanilha: 2,
    rotaDiferente: ['EMPU0000002: Baplie CNTAC → BRSSZ, planilha CNTAC → BRPNG'],
  })
})
