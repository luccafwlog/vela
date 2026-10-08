import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaplieContainer } from '../baplieParser'

const mocks = vi.hoisted(() => ({
  existing: [] as Array<Record<string, unknown>>,
  rpc: vi.fn(),
  getBaplieManifestForVoyage: vi.fn(),
  replaceVaziosFromBaplie: vi.fn(),
  applyFlags: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: mocks.existing, error: null }) }) }),
    rpc: mocks.rpc,
  },
}))
vi.mock('../baplieReconciliation', () => ({ applyBapliePhysicalFlags: mocks.applyFlags }))
vi.mock('../vaziosImportacaoImport', () => ({
  getBaplieManifestForVoyage: mocks.getBaplieManifestForVoyage,
  replaceVaziosFromBaplie: mocks.replaceVaziosFromBaplie,
}))

import { baplieReplacementConfirmOptions, diffBaplieStaging, reimportBaplie } from '../baplieImport'

const box = (container_number: string, over: Partial<BaplieContainer> = {}): BaplieContainer => ({
  container_number, size_type: '40HC', status: 'empty', weight_kg: 3800, pol: 'CNTAC', pod: 'BRVIX',
  final_dest: null, bl_ref: null, slot: '010203', is_imo: false, imo_class: null, un_number: null, is_oog: false, ...over,
})

beforeEach(() => {
  mocks.existing = []
  mocks.rpc.mockReset().mockResolvedValue({ error: null })
  mocks.getBaplieManifestForVoyage.mockReset().mockResolvedValue({ id: 'vazios-1', total_containers: 2, imported_at: '2026-09-30' })
  mocks.replaceVaziosFromBaplie.mockReset().mockResolvedValue({ manifestId: 'vazios-2', total: 2 })
  mocks.applyFlags.mockReset().mockResolvedValue(0)
})

describe('diffBaplieStaging', () => {
  it('lista incluídos, removidos e alterados; slot e peso não contam', () => {
    const diff = diffBaplieStaging(
      [box('AAAU1111111'), box('BBBU2222222'), box('CCCU3333333', { status: 'full' })],
      [box('AAAU1111111', { slot: '999999', weight_kg: 1 }), box('CCCU3333333', { status: 'empty' }), box('DDDU4444444')],
    )
    expect(diff).toMatchObject({ added: 1, removed: 1, changed: 1, vaziosChanged: true })
    expect(diff.items).toEqual([
      'Alterado: CCCU3333333 (cheio, CNTAC → BRVIX, 40HC ⇒ vazio, CNTAC → BRVIX, 40HC)',
      'Incluído: DDDU4444444 (vazio, CNTAC → BRVIX, 40HC)',
      'Removido: BBBU2222222 (vazio, CNTAC → BRVIX, 40HC)',
    ])
  })

  it('mudança só em cheios não marca os vazios como alterados', () => {
    const diff = diffBaplieStaging([box('AAAU1111111'), box('CCCU3333333', { status: 'full' })], [box('AAAU1111111'), box('CCCU3333333', { status: 'full', is_imo: true })])
    expect(diff.changed).toBe(1)
    expect(diff.vaziosChanged).toBe(false)
  })
})

describe('reimportBaplie', () => {
  const confirmReplacement = vi.fn<(plan: unknown) => Promise<boolean>>()
  const run = (containers: BaplieContainer[]) =>
    reimportBaplie({ voyageId: 22, containers, actorId: 'user-1', confirmReplacement })

  beforeEach(() => { confirmReplacement.mockReset() })

  it('sem Baplie anterior importa sem perguntar', async () => {
    await expect(run([box('AAAU1111111')])).resolves.toEqual({ status: 'imported', staged: 1, vaziosReplaced: false, flagsError: null })
    expect(mocks.applyFlags).toHaveBeenCalledWith(22, 'user-1')
    expect(confirmReplacement).not.toHaveBeenCalled()
  })

  it('arquivo sem diferença é aceito sem perguntar e mantém os vazios', async () => {
    mocks.existing = [box('AAAU1111111'), box('BBBU2222222')]
    await expect(run([box('BBBU2222222'), box('AAAU1111111')])).resolves.toEqual({ status: 'unchanged', staged: 2, vaziosReplaced: false, flagsError: null })
    expect(confirmReplacement).not.toHaveBeenCalled()
    expect(mocks.replaceVaziosFromBaplie).not.toHaveBeenCalled()
  })

  it('com diferença pergunta; recusar não grava nada', async () => {
    mocks.existing = [box('AAAU1111111')]
    confirmReplacement.mockResolvedValue(false)
    await expect(run([box('AAAU1111111'), box('BBBU2222222')])).resolves.toEqual({ status: 'cancelled' })
    expect(confirmReplacement).toHaveBeenCalledWith(expect.objectContaining({ existing: 1, hasVaziosManifest: true }))
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.applyFlags).not.toHaveBeenCalled()
    expect(mocks.replaceVaziosFromBaplie).not.toHaveBeenCalled()
  })

  it('confirmar com vazios diferentes substitui o Baplie e recadastra os vazios', async () => {
    mocks.existing = [box('AAAU1111111')]
    confirmReplacement.mockResolvedValue(true)
    await expect(run([box('AAAU1111111'), box('BBBU2222222')])).resolves.toEqual({ status: 'replaced', staged: 2, vaziosReplaced: true, flagsError: null })
    expect(mocks.rpc).toHaveBeenCalledWith('import_baplie_staging_transactional', expect.objectContaining({ p_voyage_id: 22 }))
    expect(mocks.replaceVaziosFromBaplie).toHaveBeenCalledWith({ voyageId: 22, uploadedBy: 'user-1' })
  })

  it('falha ao aplicar IMO/OOG não desfaz o Baplie gravado e volta como flagsError', async () => {
    mocks.applyFlags.mockRejectedValue({ message: 'statement timeout' })
    await expect(run([box('AAAU1111111', { status: 'full', is_imo: true })])).resolves.toEqual({
      status: 'imported', staged: 1, vaziosReplaced: false, flagsError: 'statement timeout',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('import_baplie_staging_transactional', expect.objectContaining({ p_voyage_id: 22 }))
  })

  it('IMO/OOG são aplicados antes dos vazios e a falha dos vazios cita as duas pendências', async () => {
    mocks.existing = [box('AAAU1111111')]
    confirmReplacement.mockResolvedValue(true)
    mocks.applyFlags.mockRejectedValue(new Error('flags falharam'))
    mocks.replaceVaziosFromBaplie.mockRejectedValue(new Error('vazios falharam'))
    await expect(run([box('AAAU1111111'), box('BBBU2222222')])).rejects.toThrow(
      'Baplie importado, mas os vazios de importação não foram recadastrados: vazios falharam IMO/OOG também não foram aplicados aos B/Ls: flags falharam',
    )
    expect(mocks.applyFlags.mock.invocationCallOrder[0]).toBeLessThan(mocks.replaceVaziosFromBaplie.mock.invocationCallOrder[0])
  })

  it('sem manifesto de vazios anterior não cria vazios na reimportação', async () => {
    mocks.existing = [box('AAAU1111111')]
    mocks.getBaplieManifestForVoyage.mockResolvedValue(null)
    confirmReplacement.mockResolvedValue(true)
    await expect(run([box('BBBU2222222')])).resolves.toMatchObject({ status: 'replaced', vaziosReplaced: false })
    expect(mocks.replaceVaziosFromBaplie).not.toHaveBeenCalled()
  })
})

it('o diálogo mostra a diferença e avisa que o Nº do manifesto Mercante é mantido', () => {
  const diff = diffBaplieStaging([box('AAAU1111111')], [box('BBBU2222222')])
  const options = baplieReplacementConfirmOptions({ existing: 1, diff, hasVaziosManifest: true }, 1)
  expect(options.affected).toEqual({ summary: '1 incluído(s), 1 removido(s), 0 alterado(s)', items: diff.items })
  expect(options.consequence).toMatch(/recadastrados[\s\S]*Nº do manifesto Mercante de vazios já informado é mantido/)
})
