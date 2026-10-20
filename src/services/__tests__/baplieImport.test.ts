import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaplieContainer } from '../baplieParser'

const mocks = vi.hoisted(() => ({
  existing: [] as Array<Record<string, unknown>>,
  voyage: { voyage_number: '12N', vessel: { name: 'GREEN SANTOS' } } as Record<string, unknown> | null,
  voyageContainers: [] as Array<{ container_number: string | null }>,
  containerFilters: [] as Array<[string, string, unknown]>,
  rpc: vi.fn(),
  getBaplieManifestForVoyage: vi.fn(),
  replaceVaziosFromBaplie: vi.fn(),
  applyFlags: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    // listBaplieStagingForDiff pagina (order + range): uma página basta aqui.
    // fetchBaplieVoyageContext lê a Viagem com maybeSingle.
    // Os containers dos B/Ls da Viagem (decisão 6) filtram por B/L ativo (`is`).
    from: () => ({
      select: () => ({
        eq: (column: string, value: unknown) => ({
          order: () => ({ range: () => Promise.resolve({ data: mocks.existing, error: null }) }),
          maybeSingle: () => Promise.resolve({ data: mocks.voyage, error: null }),
          is: (isColumn: string, isValue: unknown) => {
            mocks.containerFilters.push(['eq', column, value], ['is', isColumn, isValue])
            return { order: () => ({ range: () => Promise.resolve({ data: mocks.voyageContainers, error: null }) }) }
          },
        }),
      }),
    }),
    rpc: mocks.rpc,
  },
}))
vi.mock('../baplieReconciliation', () => ({ applyBapliePhysicalFlagsDetailed: mocks.applyFlags }))
vi.mock('../vaziosImportacaoImport', () => ({
  getBaplieManifestForVoyage: mocks.getBaplieManifestForVoyage,
  replaceVaziosFromBaplie: mocks.replaceVaziosFromBaplie,
}))

import {
  applyBaplieVoyageRules,
  baplieImportToast,
  baplieReplacementConfirmOptions,
  baplieVoyageContextBlock,
  diffBaplieStaging,
  fetchBaplieVoyageContext,
  reimportBaplie,
  retryBaplieVazios,
} from '../baplieImport'

const box = (container_number: string, over: Partial<BaplieContainer> = {}): BaplieContainer => ({
  container_number, size_type: '40HC', status: 'empty', weight_kg: 3800, pol: 'CNTAC', pod: 'BRVIX',
  final_dest: null, bl_ref: null, slot: '010203', is_imo: false, imo_class: null, un_number: null, is_oog: false, ...over,
})

beforeEach(() => {
  mocks.existing = []
  mocks.voyageContainers = []
  mocks.containerFilters = []
  // Staging não devolve dados; a prévia das marcas (migration 182) vem vazia.
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
      status: 'replaced', staged: 2, vaziosReplaced: false, vaziosRemoved: false, flagsError: 'flags falharam', flags: null, vaziosError: 'vazios falharam',
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

  // Migration 336: um Baplie sempre traz os vazios; sem nenhum, os do Baplie anterior saem.
  it('Baplie novo sem vazios avisa antes de confirmar e remove os vazios do Baplie anterior', async () => {
    mocks.existing = [box('AAAU1111111'), box('BBBU2222222')]
    mocks.replaceVaziosFromBaplie.mockResolvedValue({ manifestId: null, total: 0 })
    confirmReplacement.mockResolvedValue(true)
    const result = await run([box('AAAU1111111', { status: 'full' })])
    expect(confirmReplacement).toHaveBeenCalledWith(expect.objectContaining({ vaziosManifestTotal: 2, incomingEmpties: 0 }))
    const plan = confirmReplacement.mock.calls[0][0] as Parameters<typeof baplieReplacementConfirmOptions>[0]
    expect(baplieReplacementConfirmOptions(plan, 1).consequence).toMatch(/não traz vazios: os 2 vazios de importação vindos do Baplie anterior saem da Viagem/)
    expect(result).toMatchObject({ status: 'replaced', vaziosReplaced: false, vaziosRemoved: true, vaziosError: null })
    expect(baplieImportToast(result as Exclude<typeof result, { status: 'cancelled' }>))
      .toContain('Vazios de importação do Baplie anterior removidos (este Baplie não traz vazios).')
  })

  it('retryBaplieVazios devolve quantos vazios ficaram (0 quando o Baplie não traz vazios)', async () => {
    await expect(retryBaplieVazios({ voyageId: 22, actorId: 'user-1' })).resolves.toBe(2)
    mocks.replaceVaziosFromBaplie.mockResolvedValue({ manifestId: null, total: 0 })
    await expect(retryBaplieVazios({ voyageId: 22, actorId: 'user-1' })).resolves.toBe(0)
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

describe('revisão da etapa 9 (E9)', () => {
  const context = { voyageNumber: '12N', vesselName: 'GREEN SANTOS', eligiblePods: [] }
  const parsed = (over: Partial<Parameters<typeof applyBaplieVoyageRules>[0]>) =>
    ({ containers: [box('AAAU1111111')], issues: [], voyage_number: '12N', vessel_name: 'GREEN SANTOS', vessel_name_source: 'identification' as const, ...over })

  // E9-01: get_voyage_eligible_pods não tem GRANT para authenticated.
  it('lê as escalas pela RPC guardada list_voyage_eligible_pods', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ pod: 'BRVIX' }, { pod: 'BRSSZ' }], error: null })
    await expect(fetchBaplieVoyageContext(22)).resolves.toEqual({ voyageNumber: '12N', vesselName: 'GREEN SANTOS', eligiblePods: ['BRVIX', 'BRSSZ'], blContainerNumbers: [] })
    expect(mocks.rpc).toHaveBeenCalledWith('list_voyage_eligible_pods', { p_voyage_id: 22 })
    expect(mocks.rpc).not.toHaveBeenCalledWith('get_voyage_eligible_pods', expect.anything())
  })

  it('sem a Viagem conferida a importação fica bloqueada, com o motivo da falha', () => {
    expect(baplieVoyageContextBlock({ data: undefined, isError: false })).toEqual({ state: 'loading', message: expect.stringMatching(/Conferindo/) })
    expect(baplieVoyageContextBlock({ data: undefined, isError: true, error: { code: '42501', message: 'permission denied for function list_voyage_eligible_pods' } }))
      .toEqual({ state: 'error', message: 'Não foi possível conferir a Viagem: Sem permissao para esta acao. Solicite acesso administrativo.' })
    // Falha de refetch com dado antigo também bloqueia: a conferência não está confirmada.
    expect(baplieVoyageContextBlock({ data: context, isError: true, error: new Error('rede') })?.state).toBe('error')
    expect(baplieVoyageContextBlock({ data: context, isError: false })).toBeNull()
  })

  // E9-03a: zeros à esquerda não mudam a viagem (regra de blDocumentImport.ts).
  it('viagem 0012N do TDT é a mesma 12N da Viagem', () => {
    const ruled = applyBaplieVoyageRules(parsed({ voyage_number: '0012N' }), context)
    expect(ruled.issues).toEqual([])
    expect(applyBaplieVoyageRules(parsed({ voyage_number: '13N' }), context).issues)
      .toEqual([expect.objectContaining({ field: 'voyage', severity: 'error' })])
  })

  // E9-03b: só o nome vindo do C222 bloqueia; o palpite só avisa.
  it('navio diferente bloqueia só quando o nome vem da identificação do transporte', () => {
    expect(applyBaplieVoyageRules(parsed({ vessel_name: 'DGXX', vessel_name_source: 'heuristic' }), context).issues)
      .toEqual([expect.objectContaining({ field: 'vessel', severity: 'warning', message: expect.stringMatching(/nome lido \(DGXX\)/) })])
    expect(applyBaplieVoyageRules(parsed({ vessel_name: 'GREEN VITORIA', vessel_name_source: 'identification' }), context).issues)
      .toEqual([expect.objectContaining({ field: 'vessel', severity: 'error' })])
  })

  // ADR 0079, decisão 6: a referência de "outro operador" são os containers dos B/Ls da Viagem.
  describe('container de outro operador', () => {
    const file = (operator: string | null) => parsed({
      operator,
      containers: [
        box('COSU1000018', { operator: 'COS' }),
        box('COSU1000023', { operator: 'COS' }),
        box('MSCU1000017', { operator: 'MSC' }),
        box('ONEU1000016'),
      ],
    })

    it('lê os containers dos B/Ls ativos da Viagem', async () => {
      mocks.rpc.mockResolvedValue({ data: [], error: null })
      mocks.voyageContainers = [{ container_number: ' cosu1000018 ' }, { container_number: 'COSU1000018' }, { container_number: null }]
      await expect(fetchBaplieVoyageContext(22)).resolves.toMatchObject({ blContainerNumbers: ['COSU1000018'] })
      expect(mocks.containerFilters).toEqual([['eq', 'bl.voyage_id', 22], ['is', 'bl.cancelled_at', null]])
    })

    it('com o TDT do parceiro de slot, vale o operador dos containers dos B/Ls da Viagem', () => {
      const ruled = applyBaplieVoyageRules(file('MSC'), { ...context, blContainerNumbers: ['COSU1000018'] })
      expect(ruled.containers.map((c) => c.container_number)).toEqual(['COSU1000018', 'COSU1000023', 'ONEU1000016'])
      expect(ruled.issues).toEqual([
        expect.objectContaining({ severity: 'warning', message: '1 container(s) de outro operador (MSC; referência COS) ignorado(s): MSCU1000017.' }),
      ])
    })

    it('container dos B/Ls da Viagem nunca é ignorado por operador', () => {
      const ruled = applyBaplieVoyageRules(file('COS'), { ...context, blContainerNumbers: ['COSU1000018', 'MSCU1000017'] })
      expect(ruled.containers.map((c) => c.container_number)).toEqual(['COSU1000018', 'COSU1000023', 'MSCU1000017', 'ONEU1000016'])
      expect(ruled.issues).toEqual([])
    })

    it('sem container do arquivo nos B/Ls da Viagem, vale o cabeçalho com aviso', () => {
      const ruled = applyBaplieVoyageRules(file('COS'), { ...context, blContainerNumbers: ['XXXU0000000'] })
      expect(ruled.containers.map((c) => c.container_number)).toEqual(['COSU1000018', 'COSU1000023', 'ONEU1000016'])
      expect(ruled.issues).toEqual([
        expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/Nenhum container do arquivo está nos B\/Ls da Viagem: o operador de referência é o do cabeçalho do arquivo \(COS\)/) }),
        expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/de outro operador \(MSC; referência COS\)/) }),
      ])
    })

    it('cabeçalho que exclui todos os containers bloqueia com o motivo', () => {
      const ruled = applyBaplieVoyageRules(
        parsed({ operator: 'MSC', containers: [box('COSU1000018', { operator: 'COS' })] }),
        { ...context, blContainerNumbers: [] },
      )
      expect(ruled.containers).toEqual([])
      expect(ruled.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ severity: 'error', message: expect.stringMatching(/Nenhum container a importar: todos são de outro operador/) }),
      ]))
    })
  })

  // E9-08: só `reissued` é fatura reemitida; pendências e falhas aparecem à parte.
  it('o resumo conta como reemitido só o status reissued e informa pendentes e falhas', async () => {
    mocks.applyFlags.mockResolvedValue({
      applied: 1,
      applied_to: [{ container: 'AAAU1111111', bl_id: 'BL-1' }],
      cleared: [],
      divergent_manual: [],
      invoice_reissues: [
        { bl_id: 'BL-1', status: 'reissued' },
        { bl_id: 'BL-2', status: 'pending', pending_reason: 'sem usuario para reemitir' },
        { bl_id: 'BL-3', status: 'has_payment' },
        { bl_id: 'BL-4', status: 'corrected' },
        { status: 'error', bl_ids: ['BL-5', 'BL-6'], message: 'deadlock' },
      ],
    })
    const result = await reimportBaplie({ voyageId: 22, containers: [box('AAAU1111111', { status: 'full' })], actorId: 'user-1', confirmReplacement: vi.fn() })
    expect(result).toMatchObject({ status: 'imported', flags: { reissues: 1, corrected: 1, reissuesPending: 2, reissueErrors: 2 } })
    const toast = baplieImportToast(result as Exclude<typeof result, { status: 'cancelled' }>)
    expect(toast).toContain('fatura reemitida pela mudança de base em 1 B/L(s)')
    expect(toast).toContain('fatura não reemitida em 2 B/L(s) (pendente em Alertas)')
    expect(toast).toContain('falha ao refazer a fatura em 2 B/L(s)')
    expect(toast).not.toMatch(/5 fatura/)
  })
})
