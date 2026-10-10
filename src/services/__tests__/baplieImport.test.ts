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
    // listBaplieStagingForDiff pagina (order + range): uma página basta aqui.
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range: () => Promise.resolve({ data: mocks.existing, error: null }) }) }) }) }),
    rpc: mocks.rpc,
  },
}))
vi.mock('../baplieReconciliation', () => ({ applyBapliePhysicalFlagsDetailed: mocks.applyFlags }))
vi.mock('../vaziosImportacaoImport', () => ({
  getBaplieManifestForVoyage: mocks.getBaplieManifestForVoyage,
  replaceVaziosFromBaplie: mocks.replaceVaziosFromBaplie,
}))

import { applyBaplieVoyageRules, baplieReplacementConfirmOptions, diffBaplieStaging, reimportBaplie, retryBaplieVazios } from '../baplieImport'

const box = (container_number: string, over: Partial<BaplieContainer> = {}): BaplieContainer => ({
  container_number, size_type: '40HC', status: 'empty', weight_kg: 3800, pol: 'CNTAC', pod: 'BRVIX',
  final_dest: null, bl_ref: null, slot: '010203', is_imo: false, imo_class: null, un_number: null, is_oog: false, ...over,
})

beforeEach(() => {
  mocks.existing = []
  // Staging não devolve dados; a prévia das marcas (migration 181) vem vazia.
  mocks.rpc.mockReset().mockResolvedValue({ data: { apply: [], clear: [], divergent_manual: [] }, error: null })
  mocks.getBaplieManifestForVoyage.mockReset().mockResolvedValue({ id: 'vazios-1', total_containers: 2, imported_at: '2026-09-30' })
  mocks.replaceVaziosFromBaplie.mockReset().mockResolvedValue({ manifestId: 'vazios-2', total: 2 })
  mocks.applyFlags.mockReset().mockResolvedValue({ applied: 0, applied_to: [], cleared: [], divergent_manual: [], invoice_reissues: [] })
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
    await expect(run([box('AAAU1111111')])).resolves.toMatchObject({ status: 'imported', staged: 1, vaziosReplaced: false, flagsError: null, vaziosError: null })
    expect(mocks.applyFlags).toHaveBeenCalledWith(22, 'user-1')
    expect(confirmReplacement).not.toHaveBeenCalled()
  })

  it('arquivo sem diferença é aceito sem perguntar e mantém os vazios', async () => {
    mocks.existing = [box('AAAU1111111'), box('BBBU2222222')]
    await expect(run([box('BBBU2222222'), box('AAAU1111111')])).resolves.toMatchObject({ status: 'unchanged', staged: 2, vaziosReplaced: false, flagsError: null, vaziosError: null })
    expect(confirmReplacement).not.toHaveBeenCalled()
    expect(mocks.replaceVaziosFromBaplie).not.toHaveBeenCalled()
  })

  it('com diferença pergunta; recusar não grava nada', async () => {
    mocks.existing = [box('AAAU1111111')]
    confirmReplacement.mockResolvedValue(false)
    await expect(run([box('AAAU1111111'), box('BBBU2222222')])).resolves.toMatchObject({ status: 'cancelled' })
    expect(confirmReplacement).toHaveBeenCalledWith(expect.objectContaining({ existing: 1, hasVaziosManifest: true }))
    // Só a prévia das marcas (leitura) rodou; nada foi gravado.
    expect(mocks.rpc).not.toHaveBeenCalledWith('import_baplie_staging_transactional', expect.anything())
    expect(mocks.applyFlags).not.toHaveBeenCalled()
    expect(mocks.replaceVaziosFromBaplie).not.toHaveBeenCalled()
  })

  it('confirmar com vazios diferentes substitui o Baplie e recadastra os vazios', async () => {
    mocks.existing = [box('AAAU1111111')]
    confirmReplacement.mockResolvedValue(true)
    await expect(run([box('AAAU1111111'), box('BBBU2222222')])).resolves.toMatchObject({ status: 'replaced', staged: 2, vaziosReplaced: true, flagsError: null, vaziosError: null })
    expect(mocks.rpc).toHaveBeenCalledWith('import_baplie_staging_transactional', expect.objectContaining({ p_voyage_id: 22 }))
    expect(mocks.replaceVaziosFromBaplie).toHaveBeenCalledWith({ voyageId: 22, uploadedBy: 'user-1' })
  })

  it('falha ao aplicar IMO/OOG não desfaz o Baplie gravado e volta como flagsError', async () => {
    mocks.applyFlags.mockRejectedValue({ message: 'statement timeout' })
    await expect(run([box('AAAU1111111', { status: 'full', is_imo: true })])).resolves.toEqual({
      status: 'imported', staged: 1, vaziosReplaced: false, flagsError: 'statement timeout', flags: null, vaziosError: null,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('import_baplie_staging_transactional', expect.objectContaining({ p_voyage_id: 22 }))
  })

  it('IMO/OOG são aplicados antes dos vazios e as duas falhas voltam no resultado, sem desfazer o Baplie', async () => {
    mocks.existing = [box('AAAU1111111')]
    confirmReplacement.mockResolvedValue(true)
    mocks.applyFlags.mockRejectedValue(new Error('flags falharam'))
    mocks.replaceVaziosFromBaplie.mockRejectedValue(new Error('vazios falharam'))
    await expect(run([box('AAAU1111111'), box('BBBU2222222')])).resolves.toEqual({
      status: 'replaced', staged: 2, vaziosReplaced: false, flagsError: 'flags falharam', flags: null, vaziosError: 'vazios falharam',
    })
    expect(mocks.applyFlags.mock.invocationCallOrder[0]).toBeLessThan(mocks.replaceVaziosFromBaplie.mock.invocationCallOrder[0])
  })

  it('a nova tentativa do mesmo arquivo não recadastra os vazios; retryBaplieVazios recadastra', async () => {
    // Depois da falha, o staging já é o do arquivo: reimportar não vê diferença nos vazios.
    mocks.existing = [box('AAAU1111111'), box('BBBU2222222')]
    await expect(run([box('AAAU1111111'), box('BBBU2222222')])).resolves.toMatchObject({ status: 'unchanged', vaziosReplaced: false, vaziosError: null })
    expect(mocks.replaceVaziosFromBaplie).not.toHaveBeenCalled()
    await retryBaplieVazios({ voyageId: 22, actorId: 'user-1' })
    expect(mocks.replaceVaziosFromBaplie).toHaveBeenCalledWith({ voyageId: 22, uploadedBy: 'user-1' })
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

describe('Baplie completo e regras da Viagem (etapa 9)', () => {
  it('a confirmação lista as marcas do Baplie anterior que caem', () => {
    const options = baplieReplacementConfirmOptions({
      existing: 2,
      diff: { items: ['Removido: AAAU1111111 (cheio, CNTAC → BRVIX, IMO)'], added: 0, removed: 1, changed: 0, vaziosChanged: false },
      hasVaziosManifest: false,
      flags: { apply: [], clear: [{ container: 'AAAU1111111', bl_id: 'BL-1', before: 'IMO', after: 'sem marca' }], divergent_manual: [] },
    }, 1)
    expect(options.affected.summary).toContain('1 marca(s) do Baplie anterior caem')
    expect(options.affected.items).toContain('Marca que cai: AAAU1111111 no B/L BL-1 (IMO ⇒ sem marca)')
  })

  it('TDT de outra viagem bloqueia e POD fora das escalas é ignorado com aviso', () => {
    const ruled = applyBaplieVoyageRules(
      { containers: [box('AAAU1111111', { pod: 'BRVIX' }), box('BBBU2222222', { pod: 'BRSSZ' })], issues: [], voyage_number: '14', vessel_name: 'GREEN SANTOS' },
      { voyageNumber: '15', vesselName: 'GREEN SANTOS', eligiblePods: ['BRVIX'] },
    )
    expect(ruled.containers.map((c) => c.container_number)).toEqual(['AAAU1111111'])
    expect(ruled.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', message: expect.stringMatching(/viagem 14; a viagem escolhida é 15/) }),
      expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/fora das escalas da Viagem \(BRSSZ\)/) }),
    ]))
  })
})
