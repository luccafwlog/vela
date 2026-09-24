import { beforeEach, expect, it, vi } from 'vitest'
import {
  createAlert,
  dismissAlertItem,
  FINANCIAL_ALERT_EVENTS,
  FINANCIAL_ALERT_TYPES,
  alertEntityLink,
  alertEntityLinkLabel,
  getEffectiveAlertType,
  getAlertTypeLabel,
  listFinancialAlerts,
  resolveAlertItem,
} from '../alerts'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

beforeEach(() => { rpcMock.mockReset() })

it('envia dispensa temporária ao RPC central com motivo e revisão futura', async () => {
  rpcMock.mockResolvedValue({ data: { id: 12 }, error: null })

  await expect(dismissAlertItem(12, 'aguardar retorno do armador', '2026-08-22T12:00:00Z')).resolves.toBeUndefined()
  expect(rpcMock).toHaveBeenCalledWith('dismiss_alert_item', {
    p_item_id: 12,
    p_reason: 'aguardar retorno do armador',
    p_review_at: '2026-08-22T12:00:00Z',
  })
})

it('busca cada entidade financeira, deduplica, ordena e exclui Granito/Portal/Demurrage', async () => {
  const rowsByEntityType = {
    bl: [
      { id: 10, type: 'aggregate', item_type: 'billing_calculation_blocked', entity_type: 'bl', created_at: '2026-08-18T10:00:00Z' },
      { id: 10, type: 'aggregate', item_type: 'billing_calculation_blocked', entity_type: 'bl', created_at: '2026-08-18T10:00:00Z' },
      { id: 11, type: 'portal_excecao_critica_fatura', entity_type: 'bl', created_at: '2026-08-19T10:00:00Z' },
      { id: 12, type: 'billing_auto_issue_failed', entity_type: 'granite_bl', created_at: '2026-08-20T10:00:00Z' },
    ],
    pix_transaction: [
      { id: 30, type: 'pix_unreconciled', entity_type: 'pix_transaction', created_at: '2026-08-22T10:00:00Z' },
      { id: 31, type: 'demurrage', entity_type: 'pix_transaction', created_at: '2026-08-23T10:00:00Z' },
    ],
    exchange_rate_reference: [],
  }
  rpcMock.mockImplementation(async (_name: string, args: { p_entity_type?: keyof typeof rowsByEntityType; p_offset?: number; p_limit?: number }) => ({
    data: args.p_entity_type ? rowsByEntityType[args.p_entity_type].slice(args.p_offset ?? 0, (args.p_offset ?? 0) + (args.p_limit ?? 100)) : [],
    error: null,
  }))

  // Nenhum tipo financeiro ativo aponta para 'invoice' desde a 348, então a
  // fila não consulta mais essa entidade.
  await expect(listFinancialAlerts()).resolves.toEqual([
    rowsByEntityType.pix_transaction[0],
    rowsByEntityType.bl[0],
  ])
  expect(rpcMock).toHaveBeenCalledTimes(3)
  expect(rpcMock).toHaveBeenNthCalledWith(1, 'list_alert_queue_page', { p_filter: 'active', p_entity_type: 'bl', p_offset: 0, p_limit: 100 })
  expect(rpcMock).toHaveBeenNthCalledWith(2, 'list_alert_queue_page', { p_filter: 'active', p_entity_type: 'pix_transaction', p_offset: 0, p_limit: 100 })
  expect(rpcMock).toHaveBeenNthCalledWith(3, 'list_alert_queue_page', { p_filter: 'active', p_entity_type: 'exchange_rate_reference', p_offset: 0, p_limit: 100 })
})

it('combina as entidades financeiras antes de cortar a fila em 200 itens', async () => {
  const rowsByEntityType = {
    bl: Array.from({ length: 200 }, (_, index) => ({
      id: index + 1,
      type: 'billing_calculation_blocked',
      entity_type: 'bl',
      entity_id: `BL-${index + 1}`,
      created_at: '2026-08-01T10:00:00Z',
    })),
    pix_transaction: [{
      id: 202,
      type: 'pix_unreconciled',
      entity_type: 'pix_transaction',
      entity_id: 'PIX-202',
      created_at: '2026-08-21T10:00:00Z',
    }],
    exchange_rate_reference: [],
  }
  rpcMock.mockImplementation(async (_name: string, args: { p_entity_type?: keyof typeof rowsByEntityType; p_offset?: number; p_limit?: number }) => ({
    data: args.p_entity_type ? rowsByEntityType[args.p_entity_type].slice(args.p_offset ?? 0, (args.p_offset ?? 0) + (args.p_limit ?? 100)) : [],
    error: null,
  }))

  const alerts = await listFinancialAlerts()

  expect(alerts).toHaveLength(200)
  expect(alerts.slice(0, 1).map((alert) => alert.entity_id)).toEqual(['PIX-202'])
  expect(alerts.some((alert) => alert.entity_id === 'BL-1')).toBe(false)
})

it('expõe somente os tipos financeiros ativos do contrato', () => {
  // invoice_overdue saiu na 348: taxa local não tem vencimento praticado (#605).
  expect(FINANCIAL_ALERT_TYPES).toEqual([
    'billing_calculation_blocked',
    'billing_auto_issue_failed',
    'demurrage_ptax_recalc_failed',
    'pix_unreconciled',
  ])

  expect(FINANCIAL_ALERT_EVENTS).toEqual({
    billing_calculation_blocked: {
      audience: ['documentacao'],
      unit: 'bl',
    },
    billing_auto_issue_failed: {
      audience: ['documentacao'],
      unit: 'bl',
    },
    demurrage_ptax_recalc_failed: {
      audience: ['documentacao'],
      unit: 'exchange_rate_reference',
    },
    pix_unreconciled: {
      audience: ['administrativo', 'documentacao', 'equipamentos'],
      unit: 'pix_transaction',
    },
    portal_dispute_opened: {
      audience: ['equipamentos'],
      unit: 'demurrage_invoice',
    },
  })
  expect(FINANCIAL_ALERT_TYPES).not.toContain('portal_dispute_opened')
  expect(FINANCIAL_ALERT_TYPES).not.toContain('demurrage')
})

it('respeita apenas correction_route interno e seguro no bloqueio de cálculo', () => {
  expect(alertEntityLink({
    type: 'billing_calculation_blocked',
    entity_type: 'bl',
    entity_id: 'BL-1',
    metadata: { correction_route: '/taxas-locais/tabelas' },
  })).toBe('/taxas-locais/tabelas')

  expect(alertEntityLink({
    type: 'billing_calculation_blocked',
    entity_type: 'bl',
    entity_id: 'BL-2',
    metadata: { correction_route: 'https://evil.example' },
  })).toBe('/taxas-locais')
})

it('usa RPCs tipadas de faturamento, com metadata opcional, para manter idempotência', async () => {
  rpcMock.mockResolvedValue({ data: { item_id: 9 }, error: null })

  await createAlert({
    type: 'billing_calculation_blocked',
    entityType: 'bl',
    entityId: '42',
    message: 'Fatura vencida',
    metadata: { invoice_id: 42 },
  })
  await resolveAlertItem({
    type: 'billing_calculation_blocked',
    entityType: 'bl',
    entityId: '42',
  })

  expect(rpcMock).toHaveBeenNthCalledWith(1, 'upsert_billing_alert', {
    p_type: 'billing_calculation_blocked',
    p_bl_id: '42',
    p_message: 'Fatura vencida',
    p_metadata: { invoice_id: 42 },
  })
  expect(rpcMock).toHaveBeenNthCalledWith(2, 'resolve_billing_alert', {
    p_type: 'billing_calculation_blocked',
    p_bl_id: '42',
    p_metadata: {},
  })
})

it('rotula eventos ativos e preserva o rótulo legado sem tratá-lo como produtor', () => {
  expect(getAlertTypeLabel(getEffectiveAlertType({ type: 'aggregate', item_type: 'pix_unreconciled' }))).toBe('PIX sem conciliação segura')
  expect(getAlertTypeLabel(getEffectiveAlertType({ type: 'demurrage' }))).toBe('Demurrage')
expect(getAlertTypeLabel('tipo_novo_nao_catalogado')).toBe('Alerta não catalogado (tipo_novo_nao_catalogado)')
expect(getAlertTypeLabel('outro_tipo_desconhecido')).toBe('Alerta não catalogado (outro_tipo_desconhecido)')
})

it('resolve destinos pela unidade do evento e pelo identificador canônico da invoice', () => {
  expect(alertEntityLink({ type: 'portal_dispute_opened', entity_type: 'demurrage_invoice', entity_id: '77' })).toBe('/demurrage')
  expect(alertEntityLink({ type: 'portal_dispute_opened', entity_type: 'demurrage_invoice', entity_id: '77', metadata: { dispute_id: 12 } })).toBe('/demurrage?dispute=12')
  expect(alertEntityLink({ type: 'pix_unreconciled', entity_type: 'pix_transaction', entity_id: 'PIX-77' })).toBe('/reconciliacao')
  expect(alertEntityLink({ type: 'billing_calculation_blocked', entity_type: 'bl', entity_id: 'BL-77' })).toBe('/taxas-locais')
  expect(alertEntityLink({ type: 'billing_calculation_blocked', entity_type: 'bl', entity_id: 'BL-77', metadata: { correction_route: '/taxas-locais/tabelas' } })).toBe('/taxas-locais/tabelas')
  expect(alertEntityLink({ type: 'billing_calculation_blocked', entity_type: 'bl', entity_id: 'BL-77', metadata: { correction_route: '/\\evil' } })).toBe('/taxas-locais')
  expect(alertEntityLink({ type: 'billing_auto_issue_failed', entity_type: 'bl', entity_id: 'BL-78' })).toBe('/taxas-locais')
  expect(alertEntityLink({
    type: 'portal_excecao_critica_fatura',
    entity_type: 'bl',
    entity_id: 'BL/77',
    metadata: { invoice_id: 42 },
  })).toBe('/bls/BL%2F77?tab=faturamento')
  expect(alertEntityLink({
    type: 'invoice_overdue',
    entity_type: 'invoice',
    entity_id: 'INV-2026-0007',
    metadata: { invoice_id: 42, invoice_number: 'INV-2026-0007' },
  })).toBe('/taxas-locais?invoice=42')
  expect(alertEntityLink({ type: 'invoice_overdue', entity_type: 'invoice', entity_id: 'INV-2026-0007' })).toBe('/taxas-locais')
})

it('rotula billing de B/L como Taxas Locais e preserva a exceção do Portal como Abrir B/L', () => {
  expect(alertEntityLinkLabel({ type: 'billing_calculation_blocked', entity_type: 'bl' })).toBe('Taxas Locais')
  expect(alertEntityLinkLabel({ type: 'billing_auto_issue_failed', entity_type: 'bl' })).toBe('Taxas Locais')
  expect(alertEntityLinkLabel({ type: 'portal_excecao_critica_fatura', entity_type: 'bl' })).toBe('Abrir B/L')
})

it('rotula alerta de PIX como abertura da reconciliação', () => {
  expect(alertEntityLinkLabel({ type: 'pix_unreconciled', entity_type: 'pix_transaction' })).toBe('Abrir Reconciliação')
})

it('prefere item_type no payload da fundação e cai para type em payload legado', () => {
  expect(getEffectiveAlertType({ type: 'invoice_overdue' })).toBe('invoice_overdue')
  expect(getEffectiveAlertType({ type: 'aggregate', item_type: 'invoice_overdue' })).toBe('invoice_overdue')
  expect(getEffectiveAlertType({ type: 'demurrage', item_type: null })).toBe('demurrage')
  expect(getEffectiveAlertType({ type: 'demurrage' })).toBe('demurrage')
})

it('usa item_type legado para filtrar um alerta financeiro na fila', async () => {
  rpcMock.mockResolvedValue({
    data: [
      { id: 10, type: 'aggregate', item_type: 'billing_auto_issue_failed', entity_type: 'bl' },
      { id: 11, type: 'aggregate', item_type: 'portal_excecao_critica_fatura', entity_type: 'bl' },
    ],
    error: null,
  })

  await expect(listFinancialAlerts()).resolves.toEqual([
    { id: 10, type: 'aggregate', item_type: 'billing_auto_issue_failed', entity_type: 'bl' },
  ])
})
