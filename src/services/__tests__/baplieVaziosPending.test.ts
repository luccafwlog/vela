import { expect, it, vi } from 'vitest'

// ADR 0091, item 5: o recadastro dos vazios que falhou fica retomável em
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
vi.mock('../vaziosImportacaoImport', () => ({ getBaplieManifestForVoyage: vi.fn(), replaceVaziosFromBaplie: vi.fn() }))

import { hasPendingBaplieVazios } from '../baplieImport'

const staged = (container_number: string, status: string, pod = 'BRVIX') => ({ container_number, status, pol: 'CNTAC', pod })
const registered = (container_number: string, pod = 'BRVIX') => ({ container_number, pol: 'CNTAC', pod })

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
