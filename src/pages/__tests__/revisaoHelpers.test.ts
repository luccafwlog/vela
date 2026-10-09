import { describe, expect, it } from 'vitest'
import {
  customerHasEmail,
  getConsigneeFilterOptions,
  getReviewItemDocumentCandidates,
  getReviewItemCnpj,
  getReviewItemDisplayName,
  getReviewCargoTypeLabel,
  getSelectionConsignee,
  groupNeedsEmail,
  groupNeedsPortal,
  groupReviewItems,
  needsCustomerLink,
  needsWeightFix,
  flattenReviewGroupIds,
  getReviewGroupCnpjEvidence,
  getReviewItemCauses,
  readReviewCauseParam,
  reviewReasonCause,
  reviewReasonLabel,
  sortReviewGroupsByPriority,
  splitReviewNotes,
  summarizeRemainingPendencies,
  summarizeReviewGroup,
  validateWeightTon,
} from '../revisaoHelpers'
import { extractCnpjFromText, extractCnpjsFromText } from '../../lib/cnpj'
import type { ReviewQueueItem } from '../../hooks/useReview'

function item(overrides: Record<string, unknown>): ReviewQueueItem {
  return { source: 'bl', customer_id: 1, review_reasons: [], cargo_mode: 'container', ...overrides } as unknown as ReviewQueueItem
}

describe('needsCustomerLink', () => {
  it('é verdadeiro só quando não há cliente vinculado', () => {
    expect(needsCustomerLink(item({ customer_id: null }))).toBe(true)
    expect(needsCustomerLink(item({ customer_id: 5 }))).toBe(false)
  })
})

describe('rótulos da fila de revisão', () => {
  it('padroniza a pendência de cliente sem alterar o valor bruto do motivo', () => {
    expect(reviewReasonLabel('Cliente nao vinculado')).toBe('Sem cliente vinculado')
    expect(reviewReasonLabel('Cliente nao vinculado (Granito)')).toBe('Granito sem cliente vinculado')
    expect(reviewReasonLabel('Acesso ao portal nao provisionado')).toBe('Portal não provisionado')
    expect(reviewReasonLabel('Peso BB ausente')).toBe('Peso da carga solta ausente')
    expect(reviewReasonLabel('CE Mercante ausente')).toBe('CE Mercante ausente')
  })

  it('exibe a modalidade operacional do B/L', () => {
    expect(getReviewCargoTypeLabel(item({ source: 'bl', cargo_mode: 'container' }))).toBe('Contêiner')
    expect(getReviewCargoTypeLabel(item({ source: 'bl', cargo_mode: 'carga_solta' }))).toBe('Carga solta')
  })
})

describe('needsWeightFix', () => {
  it('detecta pelo motivo de revisão', () => {
    expect(needsWeightFix(item({ source: 'bl', review_reasons: ['Weight Ton ausente'] }))).toBe(true)
    expect(needsWeightFix(item({ source: 'bl', review_reasons: ['peso BB invalido'] }))).toBe(true)
  })

  it('detecta carga solta sem peso em toneladas', () => {
    expect(needsWeightFix(item({ source: 'bl', cargo_mode: 'carga_solta', bb_weight_ton: null }))).toBe(true)
    expect(needsWeightFix(item({ source: 'bl', cargo_mode: 'carga_solta', bb_weight_ton: 0 }))).toBe(true)
    expect(needsWeightFix(item({ source: 'bl', cargo_mode: 'carga_solta', bb_weight_ton: 12 }))).toBe(false)
  })

  it('não vale para container sem motivo, nem para fontes não-B/L', () => {
    expect(needsWeightFix(item({ source: 'bl', cargo_mode: 'container' }))).toBe(false)
    expect(needsWeightFix(item({ source: 'granite', cargo_mode: 'carga_solta', bb_weight_ton: null }))).toBe(false)
  })
})


describe('getConsigneeFilterOptions', () => {
  it('lista consignatarios unicos ordenados, ignorando vazios', () => {
    const rows = [
      item({ id: 'BL1', consignee: 'Beta Trading' }),
      item({ id: 'BL2', consignee: '  Alfa Import  ' }),
      item({ id: 'BL3', consignee: 'Beta Trading' }),
      item({ id: 'BL4', consignee: '' }),
      item({ id: 'BL5', consignee: null }),
    ]

    expect(getConsigneeFilterOptions(rows)).toEqual(['Alfa Import', 'Beta Trading'])
  })
})

describe('getSelectionConsignee', () => {
  it('retorna o consignatario quando todos os selecionados pertencem ao mesmo', () => {
    const rows = [
      item({ id: 'BL1', consignee: 'AC Comercial' }),
      item({ id: 'BL2', consignee: ' AC Comercial ' }),
    ]

    expect(getSelectionConsignee(rows)).toBe('AC Comercial')
  })

  it('retorna null quando a selecao mistura consignatarios', () => {
    const rows = [
      item({ id: 'BL1', consignee: 'AC Comercial' }),
      item({ id: 'BL2', consignee: 'Alma Trading' }),
    ]

    expect(getSelectionConsignee(rows)).toBeNull()
  })

  it('retorna null quando algum selecionado nao tem consignatario', () => {
    const rows = [
      item({ id: 'BL1', consignee: 'AC Comercial' }),
      item({ id: 'BL2', consignee: null }),
    ]

    expect(getSelectionConsignee(rows)).toBeNull()
  })
})

describe('getReviewItemCnpj', () => {
  it('prioriza o CNPJ do cliente cadastrado sobre o do manifesto', () => {
    const it1 = item({
      customer: { id: 1, name: 'Cliente X', cnpj_cpf: '11.222.333/0001-81' },
      manifest_customer_cnpj_cpf: '99999999999999',
    })
    expect(getReviewItemCnpj(it1)).toBe('11222333000181')
  })

  it('usa o CNPJ do manifesto quando nao ha cliente vinculado', () => {
    expect(getReviewItemCnpj(item({ customer: null, manifest_customer_cnpj_cpf: '11222333000181' }))).toBe(
      '11222333000181',
    )
    expect(getReviewItemCnpj(item({ customer: null, manifest_customer_cnpj_cpf: null }))).toBeNull()
  })
})

describe('getReviewItemDisplayName', () => {
  it('usa a razao social do cliente cadastrado quando existe', () => {
    expect(
      getReviewItemDisplayName(item({ customer: { id: 1, name: 'Razao Social SA', cnpj_cpf: '1' }, consignee: 'CNEE LTDA' })),
    ).toBe('Razao Social SA')
  })

  it('cai para o consignatario do manifesto quando nao ha cliente', () => {
    expect(getReviewItemDisplayName(item({ customer: null, consignee: 'CNEE LTDA' }))).toBe('CNEE LTDA')
  })
})

describe('groupReviewItems', () => {
  it('usa CNPJ válido como identidade principal do grupo', () => {
    const groups = groupReviewItems([
      item({ id: 'BL1', customer: null, consignee: 'ALFA', manifest_customer_cnpj_cpf: '11222333000181' }),
      item({ id: 'BL2', customer: null, consignee: 'ALFA', manifest_customer_cnpj_cpf: '11.222.333/0001-81' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].identityKind).toBe('document')
    expect(groups[0].candidateCnpjs).toEqual(['11222333000181'])
    expect(groups[0].canBulkOnboard).toBe(true)
    expect(groups[0].items.map((row) => row.id)).toEqual(['BL1', 'BL2'])
  })

  it('agrupa por nome apenas para visualização quando não há CNPJ válido', () => {
    const group = groupReviewItems([
      item({ id: 'BL1', customer: null, consignee: 'Alfa Import', manifest_customer_cnpj_cpf: null }),
      item({ id: 'BL2', customer: null, consignee: ' alfa import ', manifest_customer_cnpj_cpf: 'invalido' }),
    ])[0]

    expect(group.identityKind).toBe('name')
    expect(group.key).toBe('name:alfa import:missing')
    expect(group.canBulkOnboard).toBe(false)
  })

  it('segrega B/Ls do mesmo nome quando existem CNPJs diferentes', () => {
    const groups = groupReviewItems([
      item({ id: 'BL1', customer: null, consignee: 'Alfa', manifest_customer_cnpj_cpf: '11222333000181' }),
      item({ id: 'BL2', customer: null, consignee: 'Alfa', manifest_customer_cnpj_cpf: '12345678000195' }),
      item({ id: 'BL3', customer: null, consignee: 'Alfa', manifest_customer_cnpj_cpf: null }),
    ])

    expect(groups.map((group) => group.items.map((row) => row.id))).toEqual([
      ['BL1'],
      ['BL2'],
      ['BL3'],
    ])
    expect(groups.map((group) => group.identityKind)).toEqual(['document', 'document', 'name'])
  })

  it('marca conflito quando um B/L tem candidatos incompatíveis nas evidências', () => {
    const group = groupReviewItems([
      item({
        id: 'BL1',
        customer: null,
        consignee: 'Alfa',
        manifest_customer_cnpj_cpf: null,
        consignee_block: 'ALFA LTDA\nCNPJ: 11.222.333/0001-81',
        cargo_description: 'Carga geral. CNPJ 06.352.972/0001-21',
      }),
    ])[0]

    expect(group.identityKind).toBe('conflict')
    expect(group.candidateCnpjs).toEqual(['11222333000181', '06352972000121'])
    expect(group.canBulkOnboard).toBe(false)
  })

  it('não mistura um B/L sem candidato aos subgrupos documentais do mesmo nome', () => {
    const groups = groupReviewItems([
      item({ id: 'BL1', customer: null, consignee: 'Alfa', manifest_customer_cnpj_cpf: '11222333000181' }),
      item({ id: 'BL2', customer: null, consignee: 'Alfa', manifest_customer_cnpj_cpf: null }),
    ])

    expect(groups.map((group) => [group.key, group.items.map((row) => row.id)])).toEqual([
      ['document:11222333000181', ['BL1']],
      ['name:alfa:missing', ['BL2']],
    ])
  })

  it('segrega evidência incompatível do cliente já vinculado', () => {
    const groups = groupReviewItems([
      item({
        id: 'BL-LINKED',
        customer_id: 7,
        customer: { id: 7, name: 'Cliente cadastrado', cnpj_cpf: '11222333000181' },
        consignee: 'Cliente cadastrado',
        manifest_customer_cnpj_cpf: '12345678000195',
      }),
      item({
        id: 'BL-UNLINKED',
        customer: null,
        customer_id: null,
        consignee: 'Cliente cadastrado',
        manifest_customer_cnpj_cpf: '11222333000181',
      }),
    ])

    expect(groups.map((group) => [group.key, group.items.map((row) => row.id)])).toEqual([
      ['conflict:bl:BL-LINKED', ['BL-LINKED']],
      ['document:11222333000181', ['BL-UNLINKED']],
    ])
    expect(groups[0].identityKind).toBe('conflict')
  })

  it('preserva Granite sem habilitar onboarding em lote de B/L', () => {
    const group = groupReviewItems([
      item({
        source: 'granite',
        id: 'GR1',
        bl_number: 'GR-1',
        shipper: 'Alfa',
        consignee: null,
        manifest_customer_cnpj_cpf: '11222333000181',
      }),
    ])[0]

    expect(group.identityKind).toBe('document')
    expect(group.canBulkOnboard).toBe(false)
  })

  it('agrupa pelo CNPJ e nomeia pelo cliente cadastrado, ordenando por nome', () => {
    const rows = [
      item({ id: 'BL1', customer: null, consignee: 'ALFA', manifest_customer_cnpj_cpf: '11222333000181' }),
      item({
        id: 'BL2',
        customer: { id: 7, name: 'Alfa Comercio SA', cnpj_cpf: '11222333000181' },
        consignee: 'ALFA',
      }),
      item({ id: 'BL3', customer: null, consignee: 'BETA', manifest_customer_cnpj_cpf: '55666777000122' }),
    ]

    const groups = groupReviewItems(rows)
    expect(groups).toHaveLength(2)
    const alfa = groups.find((g) => g.cnpj === '11222333000181')!
    expect(alfa.items).toHaveLength(2)
    // razao social cadastrada vence o texto do manifesto
    expect(alfa.displayName).toBe('Alfa Comercio SA')
    // ordem alfabetica por nome de exibicao
    expect(groups[0].displayName).toBe('Alfa Comercio SA')
  })

  it('agrupa por nome quando nao ha CNPJ', () => {
    const rows = [
      item({ id: 'BL1', customer: null, consignee: 'SEM DOC', manifest_customer_cnpj_cpf: null }),
      item({ id: 'BL2', customer: null, consignee: 'sem doc', manifest_customer_cnpj_cpf: null }),
    ]
    expect(groupReviewItems(rows)).toHaveLength(1)
  })
})

describe('getReviewItemDocumentCandidates', () => {
  it('encontra CNPJ válido no campo do manifesto e nas evidências textuais, sem duplicatas', () => {
    const row = item({
      consignee: 'Alfa',
      manifest_customer_cnpj_cpf: '11.222.333/0001-81',
      consignee_block: 'ALFA LTDA\nCNPJ: 11.222.333/0001-81\nCNPJ: 06.352.972/0001-21',
      cargo_description: 'Carga geral. CNPJ 12.345.678/0001-95',
    })

    expect(getReviewItemDocumentCandidates(row)).toEqual([
      '11222333000181',
      '06352972000121',
      '12345678000195',
    ])
  })

  it('ignora CNPJ inválido mesmo quando está rotulado no texto', () => {
    const row = item({
      manifest_customer_cnpj_cpf: '11222333000182',
      consignee_block: 'ALFA LTDA\nCNPJ: 11.222.333/0001-82',
      cargo_description: 'CNPJ: 06.352.972/0001-21',
    })

    expect(getReviewItemDocumentCandidates(row)).toEqual(['06352972000121'])
  })
})

describe('extração de CNPJ rotulado', () => {
  it('retorna todos os CNPJs válidos na ordem e preserva o primeiro-match no adapter', () => {
    const text = 'CNPJ: 11.222.333/0001-81; CNPJ 06.352.972/0001-21; CNPJ: inválido'

    expect(extractCnpjsFromText(text)).toEqual(['11222333000181', '06352972000121'])
    expect(extractCnpjFromText(text)).toBe('11222333000181')
  })
})

describe('customerHasEmail', () => {
  it('detecta e-mail em qualquer contato (qualquer classificacao)', () => {
    expect(customerHasEmail(item({ customer: { id: 1, name: 'X', cnpj_cpf: '1', customer_contacts: [{ email: 'a@b.com' }] } }))).toBe(true)
    expect(customerHasEmail(item({ customer: { id: 1, name: 'X', cnpj_cpf: '1', customer_contacts: [{ email: '  ' }] } }))).toBe(false)
    expect(customerHasEmail(item({ customer: { id: 1, name: 'X', cnpj_cpf: '1', customer_contacts: [] } }))).toBe(false)
  })
})

describe('groupNeedsEmail / groupNeedsPortal', () => {
  it('usa as pendencias canonicas quando ha cliente vinculado', () => {
    const linkedNoEmail = groupReviewItems([
      item({
        id: 'B1',
        customer_id: 7,
        customer: { id: 7, name: 'C', cnpj_cpf: '11222333000181', customer_contacts: [] },
        review_reasons: ['Cliente sem e-mail cadastrado', 'Acesso ao portal nao provisionado'],
      }),
    ])[0]
    expect(groupNeedsEmail(linkedNoEmail)).toBe(true)
    expect(groupNeedsPortal(linkedNoEmail)).toBe(true)

    const linkedComplete = groupReviewItems([
      item({
        id: 'B2',
        customer_id: 7,
        customer: { id: 7, name: 'C', cnpj_cpf: '11222333000181', customer_contacts: [{ email: 'a@b.com' }] },
        review_reasons: [],
      }),
    ])[0]
    expect(groupNeedsEmail(linkedComplete)).toBe(false)
    expect(groupNeedsPortal(linkedComplete)).toBe(false)

    const unlinked = groupReviewItems([
      item({ id: 'B3', customer_id: null, customer: null, consignee: 'X', manifest_customer_cnpj_cpf: '11222333000181' }),
    ])[0]
    // sem cliente vinculado, e-mail/portal nao travam (a trava e "vincular cliente")
    expect(groupNeedsEmail(unlinked)).toBe(false)
    expect(groupNeedsPortal(unlinked)).toBe(false)
  })
})

describe('triagem por causa', () => {
  it('classifica os motivos brutos do gate e ignora a sugestão por nome', () => {
    expect(reviewReasonCause('Cliente nao vinculado')).toBe('cliente')
    expect(reviewReasonCause('Cliente nao vinculado (Granito)')).toBe('granito')
    expect(reviewReasonCause('Acesso ao portal nao provisionado')).toBe('portal')
    expect(reviewReasonCause('Peso BB ausente')).toBe('peso')
    expect(reviewReasonCause('Cliente sem e-mail cadastrado')).toBe('outros')
    expect(reviewReasonCause('Sugerido: Cliente X')).toBeNull()
  })

  it('deriva as causas do item também pelo vínculo e pela modalidade', () => {
    // Sem nota técnica, mas sem cliente e carga solta sem peso: o gate trava os dois.
    expect(getReviewItemCauses(item({ customer_id: null, cargo_mode: 'carga_solta', bb_weight_ton: null, review_reasons: [] }))).toEqual(['cliente', 'peso'])
    expect(getReviewItemCauses(item({ review_reasons: ['Acesso ao portal nao provisionado'] }))).toEqual(['portal'])
    expect(getReviewItemCauses(item({ source: 'granite', customer_id: null, review_reasons: ['Cliente nao vinculado (Granito)', 'Sugerido: X'] }))).toEqual(['granito'])
    expect(getReviewItemCauses(item({ review_reasons: [] }))).toEqual(['outros'])
  })

  it('lê a causa da URL e aceita o motivo bruto antigo', () => {
    expect(readReviewCauseParam(new URLSearchParams('causa=portal'))).toBe('portal')
    expect(readReviewCauseParam(new URLSearchParams('causa=xyz'))).toBeNull()
    expect(readReviewCauseParam(new URLSearchParams('motivo=Peso%20BB%20ausente'))).toBe('peso')
    expect(readReviewCauseParam(new URLSearchParams(''))).toBeNull()
  })
})

describe('próxima ação e prioridade do grupo', () => {
  const linkedPortal = item({ id: 'L1', customer_id: 7, customer: { id: 7, name: 'Beta', cnpj_cpf: '11222333000181' }, review_reasons: ['Acesso ao portal nao provisionado'] })
  const unlinkedDoc = item({ id: 'U1', customer_id: null, manifest_customer_cnpj_cpf: '06352972000121', consignee: 'Zeta', review_reasons: ['Cliente nao vinculado'] })
  const unlinkedName = item({ id: 'N1', customer_id: null, consignee: 'Sem Doc', review_reasons: ['Cliente nao vinculado'] })
  const conflict = item({ id: 'C1', customer_id: null, consignee: 'Conf', consignee_block: 'CNPJ: 11.222.333/0001-81', cargo_description: 'CNPJ 06.352.972/0001-21', review_reasons: ['Cliente nao vinculado'] })
  const weight = item({ id: 'W1', customer_id: 7, customer: { id: 7, name: 'Beta', cnpj_cpf: '11222333000181' }, cargo_mode: 'carga_solta', bb_weight_ton: null, review_reasons: ['Acesso ao portal nao provisionado', 'Peso BB ausente'] })
  const granite = item({ id: 'g1', source: 'granite', bl_number: 'G-1', customer_id: null, shipper: 'Pedra', review_reasons: ['Cliente nao vinculado (Granito)'] })

  function only(...items: ReviewQueueItem[]) {
    return groupReviewItems(items)[0]
  }

  it('escolhe a ação pelo que trava primeiro: cliente, peso, Portal, Granito', () => {
    expect(summarizeReviewGroup(only(conflict)).nextAction.kind).toBe('conflict')
    expect(summarizeReviewGroup(only(unlinkedName)).nextAction.kind).toBe('customer-name')
    const doc = summarizeReviewGroup(only(unlinkedDoc))
    expect(doc.nextAction.kind).toBe('customer')
    expect(doc.nextAction.detail).toMatch(/06\.352\.972\/0001-21/)
    expect(summarizeReviewGroup(only(weight, linkedPortal)).nextAction.kind).toBe('weight')
    expect(summarizeReviewGroup(only(linkedPortal)).nextAction.kind).toBe('portal')
    expect(summarizeReviewGroup(only(item({ ...linkedPortal, review_reasons: ['Cliente sem e-mail cadastrado'] } as never))).nextAction.kind).toBe('email')
    const graniteSummary = summarizeReviewGroup(only(granite))
    expect(graniteSummary.nextAction.kind).toBe('granite')
    expect(graniteSummary.blockedBlCount).toBe(0)
  })

  it('ordena pelo que se resolve aqui, depois Portal, depois Granito, com mais B/Ls na frente', () => {
    const groups = groupReviewItems([granite, linkedPortal, unlinkedName, unlinkedDoc, item({ ...unlinkedDoc, id: 'U2' } as never)])
    const ordered = sortReviewGroupsByPriority(groups).map((group) => group.displayName)
    expect(ordered).toEqual(['Zeta', 'Sem Doc', 'Beta', 'Pedra'])
    expect(flattenReviewGroupIds(sortReviewGroupsByPriority(groups))).toEqual(['U1', 'U2', 'N1', 'L1', 'g1'])
  })
})

describe('evidências, notas e resultado', () => {
  it('diz em que campo e em quantos B/Ls cada CNPJ foi lido', () => {
    const group = groupReviewItems([
      item({ id: 'A', customer_id: null, manifest_customer_cnpj_cpf: '11222333000181', consignee_block: 'CNPJ: 11.222.333/0001-81' }),
      item({ id: 'B', customer_id: null, manifest_customer_cnpj_cpf: '11222333000181' }),
    ])[0]
    expect(getReviewGroupCnpjEvidence(group)).toEqual([{
      cnpj: '11222333000181',
      occurrences: [{ blId: 'A', source: 'manifesto' }, { blId: 'A', source: 'consignatario' }, { blId: 'B', source: 'manifesto' }],
    }])
  })

  it('separa a nota humana da linha técnica do gate', () => {
    expect(splitReviewNotes('Ligou o armador\nPendencias de importacao: Cliente nao vinculado')).toBe('Ligou o armador')
    expect(splitReviewNotes('Pendencias de importacao: Peso BB ausente')).toBe('')
    expect(splitReviewNotes(null)).toBe('')
  })

  it('resume o que ficou pendente por motivo, contando cada B/L uma vez', () => {
    expect(summarizeRemainingPendencies([
      ['Acesso ao portal nao provisionado', 'Peso BB ausente'],
      ['Acesso ao portal nao provisionado'],
    ])).toBe('Portal não provisionado (2) · Peso da carga solta ausente (1)')
    expect(summarizeRemainingPendencies([[]])).toBeNull()
  })
})

describe('validateWeightTon', () => {
  it('aceita peso positivo com ponto ou vírgula e recusa vazio, zero e texto', () => {
    expect(validateWeightTon('12,5')).toBeNull()
    expect(validateWeightTon('0.4')).toBeNull()
    for (const bad of ['', ' ', '0', '-3', 'abc']) expect(validateWeightTon(bad)).toMatch(/maior que zero/)
  })
})
