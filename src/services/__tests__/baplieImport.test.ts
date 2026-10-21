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
  // Retorno de `import_baplie_file_atomic` (migration 388): staging, marcas e vazios numa transação.
  imported: null as null | Record<string, unknown>,
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

const noFlags = { applied: 0, applied_to: [], cleared: [], divergent_manual: [], invoice_reissues: [] }

/** Linhas do staging gravado, com o id que dá a versão conferida na gravação. */
const staged = (...rows: BaplieContainer[]) => rows.map((row, index) => ({ ...row, id: 100 + index }))

beforeEach(() => {
  mocks.existing = []
  mocks.voyageContainers = []
  mocks.containerFilters = []
  // A prévia das marcas (migration 182) vem vazia; a gravação devolve o resumo da 388.
  mocks.imported = null
  mocks.rpc.mockReset().mockImplementation(async (name: string, args: { p_rows: unknown[] }) => (name === 'import_baplie_file_atomic'
    ? { data: mocks.imported ?? { staged: args.p_rows.length, flags: noFlags, vazios: null }, error: null }
    : { data: { apply: [], clear: [], divergent_manual: [] }, error: null }))
  mocks.getBaplieManifestForVoyage.mockReset().mockResolvedValue({ id: 'vazios-1', total_containers: 2, imported_at: '2026-09-30' })
  mocks.replaceVaziosFromBaplie.mockReset().mockResolvedValue({ manifestId: 'vazios-2', total: 2 })
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
  const file = { voyageNumber: '12N', voyageConfirmed: true }
  const run = (containers: BaplieContainer[], pods = ['BRVIX']) =>
    reimportBaplie({ voyageId: 22, containers, pods, file, confirmReplacement })
  const importCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === 'import_baplie_file_atomic')

  beforeEach(() => { confirmReplacement.mockReset() })

  it('sem Baplie anterior importa sem perguntar, numa chamada só, com PODs, versão e viagem do arquivo', async () => {
    await expect(run([box('AAAU1111111')])).resolves.toMatchObject({ status: 'imported', staged: 1, vaziosReplaced: false, flagsError: null, vaziosError: null })
    expect(confirmReplacement).not.toHaveBeenCalled()
    expect(importCalls()).toEqual([['import_baplie_file_atomic', expect.objectContaining({
      p_voyage_id: 22, p_pods: ['BRVIX'], p_expected: { count: 0, max_id: null },
      p_file: { voyage_number: '12N', voyage_confirmed: true },
    })]])
    expect(mocks.replaceVaziosFromBaplie).not.toHaveBeenCalled()
  })

  it('arquivo sem diferença é aceito sem perguntar; a versão lida vai junto', async () => {
    mocks.existing = staged(box('AAAU1111111'), box('BBBU2222222'))
    await expect(run([box('BBBU2222222'), box('AAAU1111111')])).resolves.toMatchObject({ status: 'unchanged', staged: 2, vaziosReplaced: false })
    expect(confirmReplacement).not.toHaveBeenCalled()
    expect(importCalls()[0][1]).toMatchObject({ p_expected: { count: 2, max_id: 101 } })
  })

  it('com diferença pergunta; recusar não grava nada', async () => {
    mocks.existing = staged(box('AAAU1111111'))
    confirmReplacement.mockResolvedValue(false)
    await expect(run([box('AAAU1111111'), box('BBBU2222222')])).resolves.toMatchObject({ status: 'cancelled' })
    expect(confirmReplacement).toHaveBeenCalledWith(expect.objectContaining({ existing: 1, hasVaziosManifest: true }))
    // Só a prévia das marcas (leitura) rodou; nada foi gravado.
    expect(importCalls()).toEqual([])
  })

  it('confirmar com vazios diferentes substitui o Baplie; o recadastro dos vazios vem da mesma gravação', async () => {
    mocks.existing = staged(box('AAAU1111111'))
    mocks.imported = { staged: 2, flags: noFlags, vazios: { manifest_id: 'vazios-2', total: 2 } }
    confirmReplacement.mockResolvedValue(true)
    await expect(run([box('AAAU1111111'), box('BBBU2222222')])).resolves.toMatchObject({ status: 'replaced', staged: 2, vaziosReplaced: true, vaziosRemoved: false, flagsError: null, vaziosError: null })
    expect(mocks.replaceVaziosFromBaplie).not.toHaveBeenCalled()
  })

  it('a recusa do servidor (prévia velha, regra da Viagem ou falha nas marcas) volta como erro: nada foi gravado', async () => {
    mocks.rpc.mockImplementation(async (name: string) => (name === 'import_baplie_file_atomic'
      ? { data: null, error: { code: '22023', message: 'O Baplie desta viagem mudou depois da prévia (outra importação foi gravada).' } }
      : { data: { apply: [], clear: [], divergent_manual: [] }, error: null }))
    await expect(run([box('AAAU1111111', { status: 'full', is_imo: true })])).rejects.toMatchObject({ code: '22023' })
  })

  // ADR 0095, decisão 11: só os PODs marcados são substituídos.
  it('PODs desmarcados ficam fora da diferença, da prévia das marcas e da gravação', async () => {
    mocks.existing = staged(box('AAAU1111111'), box('SSZU1111111', { pod: 'BRSSZ', status: 'full' }), box('SSZU2222222', { pod: 'BRSSZ' }))
    confirmReplacement.mockResolvedValue(true)
    await run([box('AAAU1111111'), box('BBBU2222222')])
    const plan = confirmReplacement.mock.calls[0][0] as Parameters<typeof baplieReplacementConfirmOptions>[0]
    expect(plan).toMatchObject({ existing: 1, pods: ['BRVIX'], diff: { added: 1, removed: 0, changed: 0 } })
    // A Viagem continua com o vazio de Santos.
    expect(plan.incomingEmpties).toBe(3)
    expect(baplieReplacementConfirmOptions(plan, 2).message)
      .toBe('Esta viagem já tem 1 container(s) do Baplie em BRVIX. O arquivo novo, com 2 container(s), substitui esses portos; os demais portos da viagem ficam como estão.')
    expect(mocks.rpc).toHaveBeenCalledWith('preview_baplie_physical_flags', expect.objectContaining({ p_pods: ['BRVIX'] }))
    expect(importCalls()[0][1]).toMatchObject({ p_pods: ['BRVIX'], p_expected: { count: 3, max_id: 102 } })
  })

  it('container que o arquivo traz em outro POD sai do POD antigo e aparece como alterado', async () => {
    mocks.existing = staged(box('AAAU1111111', { pod: 'BRSSZ' }))
    confirmReplacement.mockResolvedValue(true)
    await run([box('AAAU1111111')])
    const plan = confirmReplacement.mock.calls[0][0] as Parameters<typeof baplieReplacementConfirmOptions>[0]
    expect(plan.diff.items).toEqual(['Alterado: AAAU1111111 (vazio, CNTAC → BRSSZ, 40HC ⇒ vazio, CNTAC → BRVIX, 40HC)'])
  })

  it('retryBaplieVazios recadastra os vazios do Baplie gravado (pendência anterior à 388)', async () => {
    await retryBaplieVazios({ voyageId: 22, actorId: 'user-1' })
    expect(mocks.replaceVaziosFromBaplie).toHaveBeenCalledWith({ voyageId: 22, uploadedBy: 'user-1' })
  })

  // Migration 336: um Baplie sempre traz os vazios; sem nenhum, os do Baplie anterior saem.
  it('Baplie novo sem vazios avisa antes de confirmar e remove os vazios do Baplie anterior', async () => {
    mocks.existing = staged(box('AAAU1111111'), box('BBBU2222222'))
    mocks.imported = { staged: 1, flags: noFlags, vazios: { manifest_id: null, total: 0 } }
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

  it('sem manifesto de vazios anterior o servidor não cria vazios na reimportação', async () => {
    mocks.existing = staged(box('AAAU1111111'))
    mocks.getBaplieManifestForVoyage.mockResolvedValue(null)
    confirmReplacement.mockResolvedValue(true)
    await expect(run([box('BBBU2222222')])).resolves.toMatchObject({ status: 'replaced', vaziosReplaced: false, vaziosRemoved: false })
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
    mocks.imported = { staged: 1, vazios: null, flags: {
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
    } }
    const result = await reimportBaplie({
      voyageId: 22, containers: [box('AAAU1111111', { status: 'full' })], pods: ['BRVIX'],
      file: { voyageNumber: '12N', voyageConfirmed: true }, confirmReplacement: vi.fn(),
    })
    expect(result).toMatchObject({ status: 'imported', flags: { reissues: 1, corrected: 1, reissuesPending: 2, reissueErrors: 2 } })
    const toast = baplieImportToast(result as Exclude<typeof result, { status: 'cancelled' }>)
    expect(toast).toContain('fatura reemitida pela mudança de base em 1 B/L(s)')
    expect(toast).toContain('fatura não reemitida em 2 B/L(s) (pendente em Alertas)')
    expect(toast).toContain('falha ao refazer a fatura em 2 B/L(s)')
    expect(toast).not.toMatch(/5 fatura/)
  })
})
