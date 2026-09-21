import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BL_FREIGHT_DIFF_LABELS,
  buildBlFreightPayload,
  buildBlFreightPreview,
  confirmBlFreightImport,
  type BlFreightImportPreview,
} from '../blFreightImport'
import type { ParsedBLDocument } from '../blParser'

const { mockRpc, mockFrom, mockTryAutoIssueInvoice } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(() => ({
    insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { id: 99 }, error: null })) })) })),
    update: vi.fn(() => ({ in: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })) })),
  })),
  mockTryAutoIssueInvoice: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: mockFrom,
  },
}))

vi.mock('../reviewBillingAutomation', () => ({
  tryAutoIssueInvoice: mockTryAutoIssueInvoice,
}))

function parsedBL(): ParsedBLDocument {
  return {
    blNumber: 'CSC45250E02Y00',
    parties: {
      shipperBlock: 'SHIPPER LTDA\nADDRESS',
      consigneeBlock: 'IMPORTADOR LTDA\nCNPJ: 12.345.678/0001-95',
      consigneeTaxId: '12345678000195',
      notifyBlock: 'NOTIFY LTDA',
      alsoNotifyBlock: '',
    },
    route: {
      receipt: 'SHANGHAI',
      pol: 'CNSHA',
      pod: 'BRSSZ',
      delivery: 'SANTOS',
      vessel: 'GREEN SANTOS',
      voyage: '14',
      movementFrom: 'CY',
      movementTo: 'CY',
    },
    dates: {
      ladenOnBoard: '2026-02-19',
      issueDate: '2026-02-20',
      issuePlace: 'SHANGHAI',
    },
    cargo: {
      description: 'BYD DOLPHIN GS 180EV, 200 UNITS\nNCM : 8703.80.00\nDG CLASS:9\nUN NCM: 3556',
      totalPackages: 200,
      packagesUnit: 'UNITS',
      dgClass: '9',
      unNumber: '3556',
    },
    containers: [
      {
        containerNumber: 'TCLU1234567',
        sealNumber: 'SEAL001',
        tareKg: 3900,
        ownership: 'COC',
        packages: '1 PKG',
        type: '40HC',
        grossWeightKg: 28000,
        cbm: 68.5,
      },
    ],
    vehicles: [{ chassis: '9BWZZZ377VT004251', containerNumber: 'TCLU1234567', blNumber: 'CSC45250E02Y00', brand: 'BYD', model: 'DOLPHIN', weightKg: 1800, cbm: 8.5 }],
    freightCharges: [
      { description: 'OCEAN FREIGHT', rateCurrency: 'USD', rateAmount: 2600, per: 'BL', currency: 'USD', amount: 2600, payment: 'PREPAID' },
      { description: 'THD', rateCurrency: 'BRL', rateAmount: 1717, per: 'CNTR', currency: 'BRL', amount: 1717, payment: 'COLLECT' },
      { description: 'BAF', rateCurrency: 'USD', rateAmount: 172, per: 'CNTR', currency: 'USD', amount: 172, payment: 'PREPAID' },
    ],
  }
}

/** B/L já gravado igual ao arquivo de `parsedBL`, para o diff isolar o que muda no teste. */
function existingBl() {
  return {
    id: 'CSC45250E02Y00',
    voyage_id: 7,
    cargo_mode: 'container' as const,
    shipper: 'SHIPPER LTDA\nADDRESS',
    consignee: 'IMPORTADOR LTDA',
    notify_party: 'NOTIFY LTDA',
    pol: 'CNSHA',
    pod: 'BRSSZ',
    place_of_delivery: 'BRSSZ',
    place_of_receipt: 'CNSHA',
    movement_from: 'CY',
    movement_to: 'CY',
    issue_place: 'SHANGHAI',
    cargo_description: 'BYD DOLPHIN GS 180EV, 200 UNITS\nNCM : 8703.80.00\nDG CLASS:9\nUN NCM: 3556',
    total_packages: 200,
    packages_unit: 'UNITS',
    consignee_phone: null,
    total_weight_kg: 28000,
    total_cbm: 68.5,
    payment_type: 'PREPAID' as const,
    bl_emission_date: '2026-02-20',
    manifest_customer_cnpj_cpf: '12345678000195',
    manifest_customer_name: 'IMPORTADOR LTDA',
    shipper_block: 'SHIPPER LTDA\nADDRESS',
    consignee_block: 'IMPORTADOR LTDA\nCNPJ: 12.345.678/0001-95',
    notify_block: 'NOTIFY LTDA',
    notify2_block: null,
    notify_cnpj_cpf: null,
    manifest_customer_email: null,
    bl_containers: [existingContainer()],
    bl_freight_lines: [],
    vehicles: [{ chassis: '9BWZZZ377VT004251' }],
  }
}

function existingContainer() {
  return {
    container_number: 'TCLU1234567',
    seal_number: 'SEAL001',
    type: '40HC',
    tare_weight_kg: 3900,
    gross_weight_kg: 28000,
    cbm: 68.5,
    is_imo: true,
    is_oog: false,
    imo_class: '9',
    un_number: '3556',
  }
}

describe('blFreightImport', () => {
  beforeEach(() => {
    mockRpc.mockReset()
    mockTryAutoIssueInvoice.mockReset()
  })

  it('builds the transactional RPC payload from a parsed COSCO BL', () => {
    const payload = buildBlFreightPayload(parsedBL(), 7)

    expect(payload).toMatchObject({
      id: 'CSC45250E02Y00',
      voyage_id: 7,
      shipper: 'SHIPPER LTDA\nADDRESS',
      consignee: 'IMPORTADOR LTDA',
      manifest_customer_cnpj_cpf: '12345678000195',
      pol: 'CNSHA',
      pod: 'BRSSZ',
      place_of_delivery: 'BRSSZ',
      place_of_receipt: 'CNSHA',
      movement_from: 'CY',
      movement_to: 'CY',
      issue_place: 'SHANGHAI',
      total_weight_kg: 28000,
      total_cbm: 68.5,
      cargo_description: 'BYD DOLPHIN GS 180EV, 200 UNITS\nNCM : 8703.80.00\nDG CLASS:9\nUN NCM: 3556',
      total_packages: 200,
      packages_unit: 'UNITS',
      consignee_phone: null,
      payment_type: 'PREPAID',
      bl_emission_date: '2026-02-20',
    })
    expect(payload.freight_lines).toEqual([
      { seq: 1, description: 'OCEAN FREIGHT', category: 'OCEAN_FREIGHT', mercante_code: null, currency: 'USD', amount: 2600, payment: 'PREPAID' },
      { seq: 2, description: 'THD', category: 'THD', mercante_code: null, currency: 'BRL', amount: 1717, payment: 'COLLECT' },
      { seq: 3, description: 'BAF', category: 'BAF', mercante_code: null, currency: 'USD', amount: 172, payment: 'PREPAID' },
    ])
    expect(payload.containers[0]).toMatchObject({
      container_number: 'TCLU1234567',
      type: '40HC',
      is_imo: true,
      imo_class: '9',
      un_number: '3556',
    })
    expect(payload.vehicles[0]).toMatchObject({ chassis: '9BWZZZ377VT004251', container_number: 'TCLU1234567', brand: 'BYD', model: 'DOLPHIN', weight_kg: 1800, cbm: 8.5 })
  })

  it('bloqueia VIN sem peso/cubagem em vez de fabricar zeros', () => {
    const doc = parsedBL()
    doc.vehicles[0] = { ...doc.vehicles[0], brand: null, model: null, weightKg: null, cbm: null }
    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
    })
    expect(preview.rows[0].status).toBe('blocked')
    expect(preview.rows[0].blockedReasons.join(' ')).toMatch(/sem marca, modelo, peso e cubagem/)
    expect(buildBlFreightPayload(doc, 7).vehicles).toEqual([])
  })

  it('extracts consignee phone and leaves non-DG containers as non-IMO', () => {
    const doc = parsedBL()
    doc.parties.consigneeBlock = 'IMPORTADOR LTDA\nTEL:+55 27 2124-1654'
    doc.cargo.dgClass = null
    doc.cargo.unNumber = null

    const payload = buildBlFreightPayload(doc, 7)

    expect(payload.consignee_phone).toBe('+55 27 2124-1654')
    expect(payload.containers[0]).toMatchObject({ is_imo: false, imo_class: null, un_number: null })
  })

  it('nao captura telefone atravessando quebra de linha do bloco consignee', () => {
    const doc = parsedBL()
    doc.parties.consigneeBlock = 'IMPORTADOR LTDA\nTEL:2124-1654\n3221 0000 CEP 29000-000'

    const payload = buildBlFreightPayload(doc, 7)

    expect(payload.consignee_phone).toBe('2124-1654')
  })

  it('parses Brazilian DD/MM/YYYY emission dates instead of aborting the import', () => {
    const doc = parsedBL()
    doc.dates.issueDate = '21/04/2026'
    doc.dates.ladenOnBoard = '20/04/2026'
    // Before the fix this produced "2104-20-26", which the RPC's ::DATE cast rejected.
    expect(buildBlFreightPayload(doc, 7).bl_emission_date).toBe('2026-04-21')

    const invalid = parsedBL()
    invalid.dates.issueDate = '99/99/9999'
    invalid.dates.ladenOnBoard = ''
    // An unparseable cell yields null, never a bad string that blows up the transaction.
    expect(buildBlFreightPayload(invalid, 7).bl_emission_date).toBeNull()
  })

  it('parses space-separated DD MM YYYY dates (real COSCO template writes Laden on Board this way, not DD/MM/YYYY)', () => {
    const doc = parsedBL()
    doc.dates.issueDate = '22 05 2026'
    doc.dates.ladenOnBoard = '22 05 2026'

    expect(buildBlFreightPayload(doc, 7).bl_emission_date).toBe('2026-05-22')
  })

  it('exposes normalized Laden on Board on preview rows without changing the RPC payload', () => {
    const doc = parsedBL()
    doc.dates.ladenOnBoard = '19/02/2026'

    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
    })

    expect(preview.rows[0].ladenOnBoard).toBe('2026-02-19')
    expect(preview.rows[0].payload).not.toHaveProperty('ladenOnBoard')
    expect(preview.rows[0].payload).toHaveProperty('laden_on_board', '2026-02-19')
  })

  it('normalizes port city names to UN/LOCODEs, keeping codes untouched', () => {
    const doc = parsedBL()
    doc.route.pol = 'CNSHA'
    doc.route.pod = 'SALVADOR, BRAZIL'
    doc.route.delivery = 'VITORIA,BRAZIL'
    const payload = buildBlFreightPayload(doc, 7)
    expect(payload.pol).toBe('CNSHA')
    expect(payload.pod).toBe('BRSSA')
    expect(payload.place_of_delivery).toBe('BRVIX')
  })

  it('normaliza e filtra containers fora do padrao ISO antes da RPC', () => {
    const doc = parsedBL()
    doc.containers = [
      { ...doc.containers[0], containerNumber: 'tclu 1234567' },
      {
        ...doc.containers[0],
        containerNumber: "OCEAN FREIGHT PREPAID SHIPPER'S LOAD STOW COUNT AND SEAL",
        sealNumber: 'BAD',
      },
    ]

    const payload = buildBlFreightPayload(doc, 7)

    expect(payload.containers.map((container) => container.container_number)).toEqual(['TCLU1234567'])
    expect(payload.total_weight_kg).toBe(28000)
    expect(payload.total_cbm).toBe(68.5)
  })

  it('links each B/L to its customer via the consignee document', () => {
    const customer = { id: 42, name: 'IMPORTADOR LTDA' }
    const preview = buildBlFreightPreview({
      documents: [parsedBL()],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      customerMaps: {
        customersByDocument: new Map([['12345678000195', customer]]),
        customersByName: new Map(),
        customersByCanonicalName: new Map(),
        canonicalList: [],
      },
    })
    expect(preview.rows[0].payload?.customer_id).toBe(42)
    expect(preview.rows[0].payload).toMatchObject({
      customer_reconciliation_status: 'matched_document',
      customer_reconciliation_notes: 'Cliente reconciliado automaticamente por CNPJ.',
      billing_hold_reason: null,
    })
  })

  it('keeps name-only customer matches under manual reconciliation', () => {
    const customer = { id: 43, name: 'IMPORTADOR LTDA' }
    const doc = parsedBL()
    doc.parties.consigneeTaxId = '00999999000100'
    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      customerMaps: {
        customersByDocument: new Map(),
        customersByName: new Map([['importador ltda', customer]]),
        customersByCanonicalName: new Map(),
        canonicalList: [],
      },
    })

    expect(preview.rows[0].payload).toMatchObject({
      customer_id: null,
      suggested_customer_id: 43,
      customer_reconciliation_status: 'matched_name',
      customer_reconciliation_notes: 'Cliente sugerido por nome; validar documento.',
      billing_hold_reason: 'Aguardando reconciliacao de cliente antes do faturamento.',
    })
  })

  it('uses the short consignee name in preview payload and name reconciliation while preserving the full block', () => {
    const customer = { id: 44, name: 'QA IMPORTADORA LTDA' }
    const doc = parsedBL()
    doc.parties.consigneeBlock = 'QA IMPORTADORA LTDA RUA X, 100\nSANTOS - SP'
    doc.parties.consigneeTaxId = '00999999000100'

    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      customerMaps: {
        customersByDocument: new Map(),
        customersByName: new Map([['qa importadora ltda', customer]]),
        customersByCanonicalName: new Map(),
        canonicalList: [],
      },
    })

    expect(preview.rows[0].payload).toMatchObject({
      consignee: 'QA IMPORTADORA LTDA',
      consignee_block: 'QA IMPORTADORA LTDA RUA X, 100\nSANTOS - SP',
      customer_id: null,
      suggested_customer_id: 44,
      customer_reconciliation_status: 'matched_name',
    })
  })

  it('flags container-set changes as override-required without dropping the payload', () => {
    const preview = buildBlFreightPreview({
      documents: [parsedBL()],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      billingLockedBlIds: new Set(['CSC45250E02Y00']),
      existingBls: [
        {
          id: 'CSC45250E02Y00',
          voyage_id: 7,
          cargo_mode: 'container',
          shipper: 'OLD SHIPPER',
          consignee: 'IMPORTADOR LTDA',
          notify_party: 'NOTIFY LTDA',
          pol: 'CNSHA',
          pod: 'BRSSZ',
          place_of_delivery: 'SANTOS',
          total_weight_kg: 1000,
          total_cbm: 10,
          payment_type: 'PREPAID',
          bl_emission_date: '2026-02-19',
          manifest_customer_cnpj_cpf: '12345678000195',
          manifest_customer_name: 'IMPORTADOR LTDA',
          bl_containers: [],
          bl_freight_lines: [],
        },
      ],
    })

    const row = preview.rows[0]
    expect(preview.summary).toMatchObject({ total: 1, blockedCount: 0, billingOverrideCount: 1 })
    expect(row?.status).toBe('updated')
    expect(row?.requiresBillingOverride).toBe(true)
    // container count 0 -> 1 is a billing impact; the row stays importable
    expect(row?.billingImpacts.some((message) => message.includes('Quantidade de containers'))).toBe(true)
    expect(row?.payload).not.toBeNull()
    expect(row?.payload?.billing_impact).toBe(true)
    expect(row?.payload?.override_billing).toBe(false)
    // weight/CBM on a container B/L are freely correctable; containers are the impact
    expect(row?.diffs.find((diff) => diff.field === 'total_weight_kg')?.billingImpact).toBe(false)
    expect(row?.diffs.find((diff) => diff.field === 'total_cbm')?.billingImpact).toBe(false)
    expect(row?.diffs.find((diff) => diff.field === 'containers')?.billingImpact).toBe(true)
    expect(row?.diffs.find((diff) => diff.field === 'shipper')?.billingImpact).toBe(false)
  })

  it('treats weight as a billing impact only for carga solta cargo', () => {
    const matchingContainer = {
      container_number: 'TCLU1234567',
      seal_number: 'SEAL001',
      type: '40HC',
      tare_weight_kg: 3900,
      gross_weight_kg: 28000,
      cbm: 68.5,
      is_imo: false,
      is_oog: false,
      imo_class: null,
      un_number: null,
    }
    const preview = buildBlFreightPreview({
      documents: [parsedBL()],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      billingLockedBlIds: new Set(['CSC45250E02Y00']),
      existingBls: [
        {
          id: 'CSC45250E02Y00',
          voyage_id: 7,
          cargo_mode: 'carga_solta',
          shipper: 'SHIPPER LTDA\nADDRESS',
          consignee: 'IMPORTADOR LTDA',
          notify_party: 'NOTIFY LTDA',
          pol: 'CNSHA',
          pod: 'BRSSZ',
          place_of_delivery: 'SANTOS',
          total_weight_kg: 999,
          total_cbm: 68.5,
          payment_type: 'PREPAID',
          bl_emission_date: '2026-02-20',
          manifest_customer_cnpj_cpf: '12345678000195',
          manifest_customer_name: 'IMPORTADOR LTDA',
          bl_containers: [matchingContainer],
          bl_freight_lines: [],
        },
      ],
    })

    const row = preview.rows[0]
    expect(row?.requiresBillingOverride).toBe(true)
    expect(row?.diffs.find((diff) => diff.field === 'total_weight_kg')?.billingImpact).toBe(true)
    expect(row?.diffs.find((diff) => diff.field === 'containers')).toBeUndefined()
    expect(row?.billingImpacts.some((message) => message.includes('Peso (carga solta'))).toBe(true)
  })

  it('flags replacing an existing shared container even when the count is unchanged', () => {
    // existing billed BL has one container that is shared with another B/L;
    // the import replaces it with the parsed unique container (same count).
    const preview = buildBlFreightPreview({
      documents: [parsedBL()],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      billingLockedBlIds: new Set(['CSC45250E02Y00']),
      sharedContainerNumbers: new Set(['SHARED000000']),
      existingBls: [
        {
          id: 'CSC45250E02Y00',
          voyage_id: 7,
          cargo_mode: 'container',
          shipper: 'SHIPPER LTDA\nADDRESS',
          consignee: 'IMPORTADOR LTDA',
          notify_party: 'NOTIFY LTDA',
          pol: 'CNSHA',
          pod: 'BRSSZ',
          place_of_delivery: 'SANTOS',
          total_weight_kg: 28000,
          total_cbm: 68.5,
          payment_type: 'PREPAID',
          bl_emission_date: '2026-02-20',
          manifest_customer_cnpj_cpf: '12345678000195',
          manifest_customer_name: 'IMPORTADOR LTDA',
          bl_containers: [
            {
              container_number: 'SHARED000000',
              seal_number: null,
              type: '40HC',
              tare_weight_kg: 3900,
              gross_weight_kg: 28000,
              cbm: 68.5,
              is_imo: false,
              is_oog: false,
              imo_class: null,
              un_number: null,
            },
          ],
          bl_freight_lines: [],
        },
      ],
    })

    const row = preview.rows[0]
    expect(row?.requiresBillingOverride).toBe(true)
    expect(row?.billingImpacts.some((message) => message.includes('compartilhados'))).toBe(true)
    expect(row?.diffs.find((diff) => diff.field === 'containers')?.billingImpact).toBe(true)
  })

  it('preserva atributos IMO/OOG existentes quando o B/L reimporta o mesmo container', () => {
    const preview = buildBlFreightPreview({
      documents: [parsedBL()],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      existingBls: [
        {
          id: 'CSC45250E02Y00',
          voyage_id: 7,
          cargo_mode: 'container',
          shipper: 'SHIPPER LTDA\nADDRESS',
          consignee: 'IMPORTADOR LTDA',
          notify_party: 'NOTIFY LTDA',
          pol: 'CNSHA',
          pod: 'BRSSZ',
          place_of_delivery: 'SANTOS',
          total_weight_kg: 28000,
          total_cbm: 68.5,
          payment_type: 'PREPAID',
          bl_emission_date: '2026-02-20',
          manifest_customer_cnpj_cpf: '12345678000195',
          manifest_customer_name: 'IMPORTADOR LTDA',
          bl_containers: [
            {
              container_number: 'TCLU1234567',
              seal_number: 'SEAL001',
              type: '40HC',
              tare_weight_kg: 3900,
              gross_weight_kg: 28000,
              cbm: 68.5,
              is_imo: true,
              is_oog: false,
              imo_class: '9',
              un_number: '3166',
            },
          ],
          bl_freight_lines: [],
        },
      ],
    })

    expect(preview.rows[0].payload?.containers[0]).toMatchObject({
      container_number: 'TCLU1234567',
      is_imo: true,
      is_oog: false,
      imo_class: '9',
      un_number: '3166',
    })
    expect(preview.rows[0].diffs.find((diff) => diff.field === 'containers')).toBeUndefined()
  })

  it('blocks a BL-detail scoped import when the file has another BL number', () => {
    const preview = buildBlFreightPreview({
      documents: [parsedBL()],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      onlyBlId: 'OUTROBL',
    })

    expect(preview.rows[0]?.status).toBe('blocked')
    expect(preview.rows[0]?.blockedReasons[0]).toContain('OUTROBL')
    expect(preview.rows[0]?.payload).toBeNull()
  })

  it('blocks a BL file from a different declared vessel/voyage', () => {
    const document = parsedBL()
    document.route.vessel = 'OTHER VESSEL'
    document.route.voyage = '99W'

    const preview = buildBlFreightPreview({
      documents: [document],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
    })

    const row = preview.rows[0]
    expect(row?.status).toBe('blocked')
    expect(row?.voyageId).toBe(7)
    expect(row?.payload).toBeNull()
    expect(row?.blockedReasons[0]).toBe('Arquivo e da viagem OTHER VESSEL / 99W, mas voce apontou GREEN SANTOS / 14.')
  })

  it('accepts prefix vessel aliases while still requiring the same voyage number', () => {
    const document = parsedBL()
    document.route.vessel = 'ZYHY JIN QU'

    const preview = buildBlFreightPreview({
      documents: [document],
      selectedVoyage: { id: 7, vesselName: 'ZHONG YUAN HAI YUN JIN QU', voyageNumber: '14' },
    })

    const row = preview.rows[0]
    expect(row?.status).not.toBe('blocked')
    expect(row?.blockedReasons).not.toContain('Arquivo e da viagem ZYHY JIN QU / 14, mas voce apontou ZHONG YUAN HAI YUN JIN QU / 14.')
    expect(row?.payload).not.toBeNull()
  })

  it('keeps concatenated vessel aliases blocked during declared voyage validation', () => {
    const document = parsedBL()
    document.route.vessel = 'CSALGOL'
    document.route.voyage = '14'

    const preview = buildBlFreightPreview({
      documents: [document],
      selectedVoyage: { id: 7, vesselName: 'COSCO SHIPPING ALGOL', voyageNumber: '14' },
    })

    const row = preview.rows[0]
    expect(row?.status).toBe('blocked')
    expect(row?.payload).toBeNull()
    expect(row?.blockedReasons[0]).toBe('Arquivo e da viagem CSALGOL / 14, mas voce apontou COSCO SHIPPING ALGOL / 14.')
  })

  it('keeps accepted vessel aliases blocked when the declared voyage number diverges after normalizeText', () => {
    const document = parsedBL()
    document.route.vessel = 'ZYHY JIN QU'
    document.route.voyage = ' 14-w '

    const preview = buildBlFreightPreview({
      documents: [document],
      selectedVoyage: { id: 7, vesselName: 'ZHONG YUAN HAI YUN JIN QU', voyageNumber: '14/W' },
    })

    const row = preview.rows[0]
    expect(row?.status).toBe('blocked')
    expect(row?.payload).toBeNull()
    expect(row?.blockedReasons[0]).toBe('Arquivo e da viagem ZYHY JIN QU / 14-w, mas voce apontou ZHONG YUAN HAI YUN JIN QU / 14/W.')
  })

  it('calls the transactional RPC only with unblocked payloads', async () => {
    mockRpc.mockResolvedValue({ data: { bls_received: 1 }, error: null })
    const preview: BlFreightImportPreview = {
      rows: [
        {
          blNumber: 'CSC45250E02Y00',
          status: 'new',
          existing: false,
          voyageId: 7,
          voyageNumber: null,
          pol: null,
          pod: null,
          ladenOnBoard: '2026-02-19',
          consigneeDocumentMatches: null,
          blockedReasons: [],
          billingImpacts: [],
          requiresBillingOverride: false,
          customerChange: null,
          requiresCustomerConfirmation: false,
          diffs: [],
          payload: buildBlFreightPayload(parsedBL(), 7),
        },
        {
          blNumber: 'BLOCKED',
          status: 'blocked',
          existing: true,
          voyageId: 7,
          voyageNumber: null,
          pol: null,
          pod: null,
          ladenOnBoard: null,
          consigneeDocumentMatches: null,
          blockedReasons: ['bloqueado'],
          billingImpacts: [],
          requiresBillingOverride: false,
          customerChange: null,
          requiresCustomerConfirmation: false,
          diffs: [],
          payload: null,
        },
      ],
      summary: { total: 2, newCount: 1, updatedCount: 0, unchangedCount: 0, blockedCount: 1, billingOverrideCount: 0, customerChangeCount: 0 },
    }

    await expect(confirmBlFreightImport(preview, 'user-1')).resolves.toEqual({
      result: { bls_received: 1 },
      refusedCustomerRelinks: [],
      calculationErrors: [],
    })
    expect(mockRpc).toHaveBeenCalledWith('import_bl_freight_with_metadata', {
      p_bls: [preview.rows[0]?.payload],
      p_changed_by: 'user-1',
      p_batch: { filename: 'importacao-bl.xlsx', voyage_id: 7, cargo_mode: 'container' },
    })
    expect(preview.rows[0]?.payload).toMatchObject({
      customer_id: null,
      customer_reconciliation_status: 'missing_customer',
      manifest_customer_cnpj_cpf: '12345678000195',
      manifest_customer_name: 'IMPORTADOR LTDA',
    })
    expect(mockTryAutoIssueInvoice).not.toHaveBeenCalled()
  })

  it('preserva os erros de calculo retornados fora do resultado da importacao', async () => {
    mockRpc.mockResolvedValue({
      data: {
        result: { bls_received: 1 },
        calculation_errors: [{ bl_id: 'COSU777', message: 'Nenhuma tabela vigente.' }],
      },
      error: null,
    })
    const preview: BlFreightImportPreview = {
      rows: [{
        blNumber: 'COSU777',
        status: 'new',
        existing: false,
        voyageId: 7,
        voyageNumber: null,
        pol: null,
        pod: null,
        ladenOnBoard: null,
        consigneeDocumentMatches: null,
        blockedReasons: [],
        billingImpacts: [],
        requiresBillingOverride: false,
        customerChange: null,
        requiresCustomerConfirmation: false,
        diffs: [],
        payload: buildBlFreightPayload(parsedBL(), 7),
      }],
      summary: { total: 1, newCount: 1, updatedCount: 0, unchangedCount: 0, blockedCount: 0, billingOverrideCount: 0, customerChangeCount: 0 },
    }

    await expect(confirmBlFreightImport(preview, 'user-1')).resolves.toMatchObject({
      result: { bls_received: 1 },
      calculationErrors: [{ blNumber: 'COSU777', message: 'Nenhuma tabela vigente.' }],
    })
  })

  it('does not trigger automatic billing during BL import after ADR 0020', async () => {
    mockRpc.mockResolvedValue({ data: { bls_received: 2 }, error: null })
    mockTryAutoIssueInvoice.mockResolvedValue({ status: 'blocked', message: 'Sem tabela vigente.' })
    const documentMatched = {
      ...buildBlFreightPayload(parsedBL(), 7),
      id: 'DOCMATCH',
      customer_id: 42,
      customer_reconciliation_status: 'matched_document' as const,
      customer_reconciliation_notes: 'Cliente reconciliado automaticamente por CNPJ.',
      billing_hold_reason: null,
    }
    const nameMatched = {
      ...buildBlFreightPayload(parsedBL(), 7),
      id: 'NAMEMATCH',
      customer_id: 43,
      customer_reconciliation_status: 'matched_name' as const,
      customer_reconciliation_notes: 'Cliente sugerido por nome; validar documento.',
      billing_hold_reason: 'Aguardando reconciliacao de cliente antes do faturamento.',
    }
    const preview: BlFreightImportPreview = {
      rows: [
        {
          blNumber: 'DOCMATCH',
          status: 'new',
          existing: false,
          voyageId: 7,
          voyageNumber: null,
          pol: null,
          pod: null,
          ladenOnBoard: '2026-02-19',
          consigneeDocumentMatches: null,
          blockedReasons: [],
          billingImpacts: [],
          requiresBillingOverride: false,
          customerChange: null,
          requiresCustomerConfirmation: false,
          diffs: [],
          payload: documentMatched,
        },
        {
          blNumber: 'NAMEMATCH',
          status: 'new',
          existing: false,
          voyageId: 7,
          voyageNumber: null,
          pol: null,
          pod: null,
          ladenOnBoard: '2026-02-19',
          consigneeDocumentMatches: null,
          blockedReasons: [],
          billingImpacts: [],
          requiresBillingOverride: false,
          customerChange: null,
          requiresCustomerConfirmation: false,
          diffs: [],
          payload: nameMatched,
        },
      ],
      summary: { total: 2, newCount: 2, updatedCount: 0, unchangedCount: 0, blockedCount: 0, billingOverrideCount: 0, customerChangeCount: 0 },
    }

    await confirmBlFreightImport(preview, 'user-1')
    expect(mockTryAutoIssueInvoice).not.toHaveBeenCalled()
  })

  it('applies the operator override flag only to billing-impacting rows', async () => {
    mockRpc.mockResolvedValue({ data: { bls_received: 2 }, error: null })
    const impactPayload = { ...buildBlFreightPayload(parsedBL(), 7), id: 'IMPACT', billing_impact: true, override_billing: false }
    const freePayload = { ...buildBlFreightPayload(parsedBL(), 7), id: 'FREE' }
    const preview: BlFreightImportPreview = {
      rows: [
        {
          blNumber: 'IMPACT',
          status: 'updated',
          existing: true,
          voyageId: 7,
          voyageNumber: null,
          pol: null,
          pod: null,
          ladenOnBoard: '2026-02-19',
          consigneeDocumentMatches: true,
          blockedReasons: [],
          billingImpacts: ['Quantidade de containers: 1 -> 2'],
          requiresBillingOverride: true,
          customerChange: null,
          requiresCustomerConfirmation: false,
          diffs: [],
          payload: impactPayload,
        },
        {
          blNumber: 'FREE',
          status: 'updated',
          existing: true,
          voyageId: 7,
          voyageNumber: null,
          pol: null,
          pod: null,
          ladenOnBoard: '2026-02-19',
          consigneeDocumentMatches: true,
          blockedReasons: [],
          billingImpacts: [],
          requiresBillingOverride: false,
          customerChange: null,
          requiresCustomerConfirmation: false,
          diffs: [],
          payload: freePayload,
        },
      ],
      summary: { total: 2, newCount: 0, updatedCount: 2, unchangedCount: 0, blockedCount: 0, billingOverrideCount: 1, customerChangeCount: 0 },
    }

    await confirmBlFreightImport(preview, 'user-1', true)
    const sent = mockRpc.mock.calls.find(([name]) => name === 'import_bl_freight_with_metadata')?.[1]?.p_bls as Array<{ id: string; override_billing: boolean }>
    expect(sent.find((bl) => bl.id === 'IMPACT')?.override_billing).toBe(true)
    expect(sent.find((bl) => bl.id === 'FREE')?.override_billing).toBe(true)

    mockRpc.mockClear()
    await confirmBlFreightImport(preview, 'user-1', false)
    const sentNoOverride = mockRpc.mock.calls.find(([name]) => name === 'import_bl_freight_with_metadata')?.[1]?.p_bls as Array<{ id: string; override_billing: boolean }>
    // impacting row stays un-applied; the free row still applies
    expect(sentNoOverride.find((bl) => bl.id === 'IMPACT')?.override_billing).toBe(false)
    expect(sentNoOverride.find((bl) => bl.id === 'FREE')?.override_billing).toBe(true)
  })
  it('mostra no diff os campos que a reimportacao sobrescrevia em silencio', () => {
    const doc = parsedBL()
    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      existingBls: [
        {
          ...existingBl(),
          shipper_block: 'OUTRO SHIPPER',
          consignee_block: 'OUTRO CONSIGNATARIO',
          notify_block: 'OUTRO NOTIFY',
          notify2_block: 'ALSO NOTIFY ANTIGO',
          notify_cnpj_cpf: '99999999000191',
          manifest_customer_email: 'antigo@cliente.com',
          vehicles: [{ chassis: 'CHASSIS-ANTIGO' }],
        },
      ],
    })

    const fields = preview.rows[0]?.diffs.map((diff) => diff.field) ?? []
    expect(fields).toEqual(
      expect.arrayContaining([
        'shipper_block',
        'consignee_block',
        'notify_block',
        'notify2_block',
        'notify_cnpj_cpf',
        'vehicles',
      ]),
    )
    // o rotulo e o que o operador le no preview; o nome da coluna nao diz nada
    expect(preview.rows[0]?.diffs.find((diff) => diff.field === 'consignee_block')?.label).toBe(
      'Consignatario (bloco completo)',
    )
    expect(BL_FREIGHT_DIFF_LABELS.cargo_description).toBe('Descricao da carga (origem do NCM)')
  })

  it('trata rota e viagem de B/L faturado como impacto de faturamento, nao como promessa vazia', () => {
    const doc = parsedBL()
    doc.route.pod = 'RIO DE JANEIRO, BRAZIL'
    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 9, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      billingLockedBlIds: new Set(['CSC45250E02Y00']),
      existingBls: [{ ...existingBl(), voyage_id: 7, bl_containers: [existingContainer()] }],
    })

    const row = preview.rows[0]
    expect(row?.requiresBillingOverride).toBe(true)
    expect(row?.billingImpacts).toEqual(expect.arrayContaining(['POD: BRSSZ -> BRRIO', 'Viagem do B/L: 7 -> 9']))
    expect(row?.diffs.find((diff) => diff.field === 'pod')?.billingImpact).toBe(true)
    expect(row?.diffs.find((diff) => diff.field === 'voyage_id')?.billingImpact).toBe(true)
  })

  it('avisa a troca de consignatario e diz qual fatura acompanha o novo cliente', () => {
    const doc = parsedBL()
    doc.parties.consigneeBlock = 'NOVO IMPORTADOR LTDA\nCNPJ: 98.765.432/0001-10'
    doc.parties.consigneeTaxId = '98765432000110'

    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      existingBls: [{ ...existingBl(), customer_id: 42, bl_containers: [existingContainer()] }],
      customerMaps: {
        customersByDocument: new Map([['98765432000110', { id: 43, name: 'NOVO IMPORTADOR LTDA' }]]),
        customersByName: new Map(),
        customersByCanonicalName: new Map(),
        canonicalList: [],
      },
      customersById: new Map([
        [42, { id: 42, name: 'IMPORTADOR LTDA', document: '12345678000195' }],
        [43, { id: 43, name: 'NOVO IMPORTADOR LTDA', document: '98765432000110' }],
      ]),
      invoicesByBl: new Map([
        [
          'CSC45250E02Y00',
          [{ blId: 'CSC45250E02Y00', invoiceNumber: 'INV-001', kind: 'local' as const, status: 'issued', totalBrl: 1500, totalPaidBrl: 0, blCount: 1 }],
        ],
      ]),
    })

    const row = preview.rows[0]
    expect(row?.requiresCustomerConfirmation).toBe(true)
    expect(preview.summary.customerChangeCount).toBe(1)
    expect(row?.customerChange).toMatchObject({ fromCustomerId: 42, toCustomerId: 43, targetMissing: false })
    expect(row?.customerChange?.messages).toEqual(
      expect.arrayContaining(['Cliente do B/L: IMPORTADOR LTDA -> NOVO IMPORTADOR LTDA']),
    )
    expect(row?.customerChange?.invoices[0]).toMatchObject({ invoiceNumber: 'INV-001', blockedReason: null })
    expect(row?.customerChange?.blockedReasons).toEqual([])
  })

  it('impede a troca automatica quando a fatura e consolidada ou ja foi paga', () => {
    const doc = parsedBL()
    doc.parties.consigneeTaxId = '98765432000110'

    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      existingBls: [{ ...existingBl(), customer_id: 42, bl_containers: [existingContainer()] }],
      customerMaps: {
        customersByDocument: new Map([['98765432000110', { id: 43, name: 'NOVO IMPORTADOR LTDA' }]]),
        customersByName: new Map(),
        customersByCanonicalName: new Map(),
        canonicalList: [],
      },
      invoicesByBl: new Map([
        [
          'CSC45250E02Y00',
          [
            { blId: 'CSC45250E02Y00', invoiceNumber: 'INV-CONS', kind: 'local' as const, status: 'issued', totalBrl: 9000, totalPaidBrl: 0, blCount: 4 },
            { blId: 'CSC45250E02Y00', invoiceNumber: 'INV-PAGA', kind: 'local' as const, status: 'issued', totalBrl: 500, totalPaidBrl: 500, blCount: 1 },
          ],
        ],
      ]),
    })

    const row = preview.rows[0]
    expect(row?.requiresCustomerConfirmation).toBe(false)
    expect(row?.customerChange?.blockedReasons).toEqual([
      'Fatura INV-CONS: consolidada com outros B/Ls; separe a cobranca antes de trocar o cliente.',
      'Fatura INV-PAGA: ja tem pagamento registrado; estorne ou cancele antes de trocar o cliente.',
    ])
  })

  it('bloqueia a troca quando o novo consignatario ainda nao e cliente e ha fatura', () => {
    const doc = parsedBL()
    doc.parties.consigneeTaxId = '98765432000110'

    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      existingBls: [{ ...existingBl(), customer_id: 42, bl_containers: [existingContainer()] }],
      invoicesByBl: new Map([
        [
          'CSC45250E02Y00',
          [{ blId: 'CSC45250E02Y00', invoiceNumber: 'INV-001', kind: 'local' as const, status: 'issued', totalBrl: 1500, totalPaidBrl: 0, blCount: 1 }],
        ],
      ]),
    })

    expect(preview.rows[0]?.customerChange?.targetMissing).toBe(true)
    expect(preview.rows[0]?.customerChange?.blockedReasons).toEqual([
      'Cliente do novo consignatario nao esta cadastrado; cadastre-o antes de reimportar para a fatura acompanhar.',
    ])
    expect(preview.rows[0]?.requiresCustomerConfirmation).toBe(false)
  })

  it('so envia relink_customer quando o operador aceita a troca', async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null })
    const doc = parsedBL()
    doc.parties.consigneeTaxId = '98765432000110'
    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      existingBls: [{ ...existingBl(), customer_id: 42, bl_containers: [existingContainer()] }],
      customerMaps: {
        customersByDocument: new Map([['98765432000110', { id: 43, name: 'NOVO IMPORTADOR LTDA' }]]),
        customersByName: new Map(),
        customersByCanonicalName: new Map(),
        canonicalList: [],
      },
    })

    await confirmBlFreightImport(preview, 'user-1', false, 'arquivo.xlsx', false)
    const withoutConfirmation = mockRpc.mock.calls.find(([name]) => name === 'import_bl_freight_with_metadata')?.[1]?.p_bls as Array<{ relink_customer: boolean }>
    expect(withoutConfirmation[0].relink_customer).toBe(false)

    mockRpc.mockClear()
    await confirmBlFreightImport(preview, 'user-1', false, 'arquivo.xlsx', true)
    const confirmed = mockRpc.mock.calls.find(([name]) => name === 'import_bl_freight_with_metadata')?.[1]?.p_bls as Array<{ relink_customer: boolean; customer_id: number | null }>
    expect(confirmed[0]).toMatchObject({ relink_customer: true, customer_id: 43 })
  })
  it('grava o NCM declarado no documento e o mostra no diff', () => {
    const doc = parsedBL()
    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      existingBls: [{ ...existingBl(), ncm_codes: ['1111'] }],
    })

    // a descricao do B/L declara "NCM : 8703.80.00" e o UN 3556 nao entra
    expect(preview.rows[0]?.payload?.ncm_codes).toEqual(['87038000'])
    expect(preview.rows[0]?.diffs.find((diff) => diff.field === 'ncm_codes')).toMatchObject({
      label: 'NCM',
      from: '1111',
      to: '87038000',
    })
  })

  it('documento sem NCM nao apaga o cadastro manual nem inventa diferenca', () => {
    const doc = parsedBL()
    doc.cargo.description = 'POLYESTER/RAYON YARN\nWOODEN PACKAGE:NOT APPLICABLE'

    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      existingBls: [{ ...existingBl(), ncm_codes: ['5509'] }],
    })

    expect(preview.rows[0]?.payload?.ncm_codes).toEqual([])
    expect(preview.rows[0]?.diffs.find((diff) => diff.field === 'ncm_codes')).toBeUndefined()
  })

  it('nao anuncia troca de consignatario em linha bloqueada, que nem chega a importar', () => {
    const doc = parsedBL()
    doc.parties.consigneeTaxId = '98765432000110'

    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      onlyBlId: 'OUTRO-BL',
      existingBls: [{ ...existingBl(), customer_id: 42, bl_containers: [existingContainer()] }],
      customerMaps: {
        customersByDocument: new Map([['98765432000110', { id: 43, name: 'NOVO IMPORTADOR LTDA' }]]),
        customersByName: new Map(),
        customersByCanonicalName: new Map(),
        canonicalList: [],
      },
    })

    expect(preview.rows[0]?.status).toBe('blocked')
    expect(preview.rows[0]?.customerChange).toBeNull()
    expect(preview.rows[0]?.requiresCustomerConfirmation).toBe(false)
    expect(preview.summary.customerChangeCount).toBe(0)
  })

  it('mostra o cliente cadastrado de destino, nao o nome solto do documento', () => {
    const doc = parsedBL()
    doc.parties.consigneeBlock = 'NOVO IMPORTADOR COMERCIO LTDA\nCNPJ: 98.765.432/0001-10'
    doc.parties.consigneeTaxId = '98765432000110'

    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      existingBls: [{ ...existingBl(), customer_id: 42, bl_containers: [existingContainer()] }],
      customerMaps: {
        customersByDocument: new Map([['98765432000110', { id: 43, name: 'NOVO IMPORTADOR LTDA' }]]),
        customersByName: new Map(),
        customersByCanonicalName: new Map(),
        canonicalList: [],
      },
      // o mapa so tem o dono atual: o cliente de destino vem do casamento do documento
      customersById: new Map([[42, { id: 42, name: 'IMPORTADOR LTDA', document: '12345678000195' }]]),
    })

    expect(preview.rows[0]?.customerChange).toMatchObject({
      toCustomerId: 43,
      toCustomerName: 'NOVO IMPORTADOR LTDA',
    })
  })

  it('bloqueia a troca por recebivel do razao: com baixa, e sem cliente de destino cadastrado', () => {
    const doc = parsedBL()
    doc.parties.consigneeTaxId = '98765432000110'

    const comBaixa = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      existingBls: [{ ...existingBl(), customer_id: 42, bl_containers: [existingContainer()] }],
      customerMaps: {
        customersByDocument: new Map([['98765432000110', { id: 43, name: 'NOVO IMPORTADOR LTDA' }]]),
        customersByName: new Map(),
        customersByCanonicalName: new Map(),
        canonicalList: [],
      },
      receivablesByBl: new Map([
        ['CSC45250E02Y00', [{ blId: 'CSC45250E02Y00', status: 'partially_settled', settledAmountBrl: 300 }]],
      ]),
    })

    expect(comBaixa.rows[0]?.customerChange?.blockedReasons).toEqual([
      'Recebivel do B/L ja tem baixa registrada; estorne no razao antes de trocar o cliente.',
    ])
    expect(comBaixa.rows[0]?.requiresCustomerConfirmation).toBe(false)

    // sem fatura viva, mas com recebivel aberto: a RPC recusa por falta de cliente de destino
    const semCliente = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      existingBls: [{ ...existingBl(), customer_id: 42, bl_containers: [existingContainer()] }],
      receivablesByBl: new Map([
        ['CSC45250E02Y00', [{ blId: 'CSC45250E02Y00', status: 'open', settledAmountBrl: 0 }]],
      ]),
    })

    expect(semCliente.rows[0]?.customerChange?.targetMissing).toBe(true)
    expect(semCliente.rows[0]?.customerChange?.blockedReasons).toEqual([
      'Cliente do novo consignatario nao esta cadastrado; cadastre-o antes de reimportar para a fatura acompanhar.',
    ])
  })

  it('trata a lista de veiculos como variavel de faturamento propria', () => {
    const doc = parsedBL()
    doc.vehicles = []

    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      billingLockedBlIds: new Set(['CSC45250E02Y00']),
      existingBls: [existingBl()],
    })

    const row = preview.rows[0]
    expect(row?.requiresBillingOverride).toBe(true)
    expect(row?.billingImpacts).toEqual(expect.arrayContaining(['Veiculos (chassis): 1 -> 0']))
    expect(row?.diffs.find((diff) => diff.field === 'vehicles')?.billingImpact).toBe(true)
    expect(row?.payload?.override_billing).toBe(false)
  })

  it('nao chama de concluida a importacao cuja troca de cliente o servidor recusou', async () => {
    mockRpc.mockResolvedValue({
      data: {
        bls_received: 1,
        customer_relinks: [
          { bl_id: 'CSC45250E02Y00', applied: false, blockers: ['Fatura INV-1 ja tem pagamento registrado.'] },
          { bl_id: 'OUTRO', applied: true, blockers: [] },
        ],
      },
      error: null,
    })
    const doc = parsedBL()
    doc.parties.consigneeTaxId = '98765432000110'
    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      existingBls: [{ ...existingBl(), customer_id: 42, bl_containers: [existingContainer()] }],
      customerMaps: {
        customersByDocument: new Map([['98765432000110', { id: 43, name: 'NOVO IMPORTADOR LTDA' }]]),
        customersByName: new Map(),
        customersByCanonicalName: new Map(),
        canonicalList: [],
      },
    })

    const outcome = await confirmBlFreightImport(preview, 'user-1', false, 'arquivo.xlsx', true)
    expect(outcome.refusedCustomerRelinks).toEqual([
      { blNumber: 'CSC45250E02Y00', blockers: ['Fatura INV-1 ja tem pagamento registrado.'] },
    ])
  })

  it('normaliza o alias QINDGAO para CNTAO nas rotas do B/L no payload e no preview', () => {
    const doc = parsedBL()
    doc.route.pol = 'QINDGAO'
    doc.route.receipt = 'QINDGAO, CHINA'
    const payload = buildBlFreightPayload(doc, 7)
    expect(payload.pol).toBe('CNTAO')
    expect(payload.place_of_receipt).toBe('CNTAO')

    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
    })
    expect(preview.rows[0].pol).toBe('CNTAO')
  })

  it('substitui integralmente blocos C5, partes, containers, pesos, fretes e descricao na reimportacao', () => {
    const doc = parsedBL()
    doc.parties.shipperBlock = 'NOVO SHIPPER COMPLETO\nENDERECO 123'
    doc.parties.consigneeBlock = 'NOVO CONSIGNEE COMPLETO\nCNPJ: 12.345.678/0001-95'
    doc.parties.notifyBlock = 'NOVO NOTIFY COMPLETO'
    doc.parties.alsoNotifyBlock = 'NOVO NOTIFY 2 COMPLETO'
    doc.cargo.description = 'NOVA DESCRICAO DA CARGA\nNCM: 8703.80.00'
    doc.cargo.totalPackages = 350
    doc.cargo.packagesUnit = 'VOLUMES'
    doc.containers = [
      {
        containerNumber: 'TCLU9999999',
        sealNumber: 'SEAL999',
        tareKg: 4000,
        ownership: 'COC',
        packages: '1 PKG',
        type: '20GP',
        grossWeightKg: 15000,
        cbm: 33.2,
      },
    ]
    doc.freightCharges = [
      { description: 'OCEAN FREIGHT', rateCurrency: 'USD', rateAmount: 3200, per: 'BL', currency: 'USD', amount: 3200, payment: 'COLLECT' },
    ]

    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      existingBls: [existingBl()],
    })

    const row = preview.rows[0]
    expect(row.status).toBe('updated')
    const diffFields = row.diffs.map((d) => d.field)
    expect(diffFields).toEqual(
      expect.arrayContaining([
        'shipper_block',
        'consignee_block',
        'notify_block',
        'notify2_block',
        'cargo_description',
        'total_packages',
        'packages_unit',
        'containers',
        'total_weight_kg',
        'total_cbm',
        'bl_freight_lines',
        'payment_type',
      ]),
    )
    expect(row.payload).toMatchObject({
      shipper_block: 'NOVO SHIPPER COMPLETO\nENDERECO 123',
      consignee_block: 'NOVO CONSIGNEE COMPLETO\nCNPJ: 12.345.678/0001-95',
      notify_block: 'NOVO NOTIFY COMPLETO',
      notify2_block: 'NOVO NOTIFY 2 COMPLETO',
      cargo_description: 'NOVA DESCRICAO DA CARGA\nNCM: 8703.80.00',
      total_packages: 350,
      packages_unit: 'VOLUMES',
      payment_type: 'COLLECT',
      total_weight_kg: 15000,
      total_cbm: 33.2,
    })
    expect(row.payload?.containers).toHaveLength(1)
    expect(row.payload?.containers[0].container_number).toBe('TCLU9999999')
    expect(row.payload?.freight_lines).toHaveLength(1)
    expect(row.payload?.freight_lines[0].description).toBe('OCEAN FREIGHT')
  })
})
