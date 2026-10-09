import { describe, expect, it } from 'vitest'
import {
  chargeTableAlerts,
  resolveChargeTableStates,
  validateOverrideInput,
  validateTableInput,
  validateTableItemInput,
} from '../taxasLocaisHelpers'

describe('validateOverrideInput', () => {
  const base = {
    customerId: '5',
    chargeItemId: '9',
    overrideValue: '12,5',
    validFrom: '',
    validTo: '',
    notes: '',
  }

  it('aceita entrada válida e normaliza valor (vírgula) e datas vazias', () => {
    const r = validateOverrideInput(base)
    expect(r).toEqual({
      ok: true,
      value: {
        customerId: 5,
        chargeItemId: 9,
        overrideValue: 12.5,
        validFrom: null,
        validTo: null,
        notes: null,
      },
    })
  })

  it('exige cliente, item e valor > 0 na ordem certa', () => {
    expect(validateOverrideInput({ ...base, customerId: '0' })).toMatchObject({
      ok: false,
      field: 'customerId',
      error: 'Selecione o Cliente da condição.',
    })
    expect(validateOverrideInput({ ...base, chargeItemId: '' })).toMatchObject({
      ok: false,
      field: 'chargeItemId',
      error: 'Selecione o item de taxa da condição.',
    })
    expect(validateOverrideInput({ ...base, overrideValue: '0' })).toMatchObject({
      ok: false,
      field: 'overrideValue',
      error: 'Informe o valor negociado (maior que zero).',
    })
  })

  it('rejeita vigência final anterior à inicial', () => {
    expect(
      validateOverrideInput({ ...base, validFrom: '2026-02-01', validTo: '2026-01-01' }),
    ).toMatchObject({ ok: false })
  })

  it('preserva datas e notas quando informadas', () => {
    const r = validateOverrideInput({ ...base, validFrom: '2026-01-01', validTo: '2026-02-01', notes: 'x' })
    expect(r).toMatchObject({ ok: true, value: { validFrom: '2026-01-01', validTo: '2026-02-01', notes: 'x' } })
  })
})

describe('validateTableInput', () => {
  const base = { name: 'THC', pod: 'BRSSZ', validFrom: '2026-01-01', validTo: '' }

  it('aceita entrada válida e normaliza validTo vazio para null', () => {
    expect(validateTableInput(base)).toEqual({ ok: true, value: { validTo: null } })
  })

  it('exige nome, pod e vigência inicial', () => {
    expect(validateTableInput({ ...base, name: '  ' })).toMatchObject({ ok: false, error: 'Informe o nome da tabela.' })
    expect(validateTableInput({ ...base, pod: '' })).toMatchObject({ ok: false, field: 'pod', error: 'Informe o POD da tabela.' })
    expect(validateTableInput({ ...base, validFrom: '' })).toMatchObject({
      ok: false,
      error: 'Informe a vigência inicial da tabela.',
    })
  })

  it('rejeita validTo anterior a validFrom', () => {
    expect(validateTableInput({ ...base, validTo: '2025-12-31' })).toMatchObject({ ok: false })
  })
})

describe('validateTableItemInput', () => {
  const base = { chargeTableId: '3', name: 'BL Fee', unitValue: '100,00', sortOrder: '10' }

  it('aceita entrada válida e converte números', () => {
    expect(validateTableItemInput(base)).toEqual({
      ok: true,
      value: { chargeTableId: 3, unitValue: 100, sortOrder: 10 },
    })
  })

  it('permite valor unitário zero, mas rejeita negativo', () => {
    expect(validateTableItemInput({ ...base, unitValue: '0' })).toMatchObject({ ok: true })
    expect(validateTableItemInput({ ...base, unitValue: '-1' })).toMatchObject({
      ok: false,
      error: 'Informe um valor unitário válido (zero ou maior).',
    })
    expect(validateTableItemInput({ ...base, unitValue: '  ' })).toMatchObject({ ok: false, field: 'unitValue' })
  })

  it('lê valor com milhar e decimal em pt-BR', () => {
    expect(validateTableItemInput({ ...base, unitValue: '1.420,50' })).toMatchObject({ ok: true, value: { unitValue: 1420.5 } })
    expect(validateTableItemInput({ ...base, unitValue: 'R$ 2.130,00' })).toMatchObject({ ok: true, value: { unitValue: 2130 } })
    expect(validateTableItemInput({ ...base, unitValue: '62.5' })).toMatchObject({ ok: true, value: { unitValue: 62.5 } })
  })

  it('exige tabela, nome e sort order válido', () => {
    expect(validateTableItemInput({ ...base, chargeTableId: '0' })).toMatchObject({
      ok: false,
      error: 'Selecione a tabela do item.',
    })
    expect(validateTableItemInput({ ...base, name: '' })).toMatchObject({
      ok: false,
      error: 'Informe o nome do item de taxa.',
    })
    expect(validateTableItemInput({ ...base, sortOrder: '-2' })).toMatchObject({
      ok: false,
      field: 'sortOrder',
      error: 'A ordem de exibição deve ser um número inteiro, zero ou maior.',
    })
  })
})

describe('chargeTableAlerts', () => {
  const base = {
    cargo_mode: 'container' as const,
    pod: 'BRVIT',
    valid_from: '2026-01-01',
    valid_to: null,
    active: true,
  }
  const today = '2026-08-07'

  it('does not warn about a single active table with an open vigência', () => {
    expect(chargeTableAlerts([{ ...base, id: 1 }], today).size).toBe(0)
  })

  it('warns that an expired vigência still charges, because it no longer filters', () => {
    const alerts = chargeTableAlerts([{ ...base, id: 1, valid_to: '2026-06-30' }], today)
    expect(alerts.get(1)?.map((alert) => alert.label)).toEqual(['Vigência vencida'])
  })

  it('warns that a future vigência is already in use', () => {
    const alerts = chargeTableAlerts([{ ...base, id: 1, valid_from: '2026-12-01' }], today)
    expect(alerts.get(1)?.map((alert) => alert.label)).toEqual(['Vigência futura'])
  })

  it('stays quiet about the vigência of an inactive table, which never reaches the engine', () => {
    const alerts = chargeTableAlerts([{ ...base, id: 1, valid_to: '2026-06-30', active: false }], today)
    expect(alerts.size).toBe(0)
  })

  it('flags the losing table when two active tables share POD and cargo mode', () => {
    const alerts = chargeTableAlerts(
      [
        { ...base, id: 1, valid_from: '2026-01-01' },
        { ...base, id: 2, valid_from: '2026-07-01' },
      ],
      today,
    )
    expect(alerts.get(1)?.map((alert) => alert.label)).toEqual(['Não aplicada'])
    expect(alerts.has(2)).toBe(false)
  })

  it('breaks a tie on equal valid_from by the highest id, like the engine does', () => {
    const alerts = chargeTableAlerts(
      [
        { ...base, id: 7 },
        { ...base, id: 9 },
      ],
      today,
    )
    expect(alerts.has(9)).toBe(false)
    expect(alerts.get(7)?.map((alert) => alert.label)).toEqual(['Não aplicada'])
  })

  it('groups POD aliases the way the database does, so the alert matches the engine', () => {
    // public.normalize_port_code (migration 063) dobra BRVIT/BRVIX/VITORIA em
    // BRVIT — o motor veria uma tabela sombreando a outra.
    const alerts = chargeTableAlerts(
      [
        { ...base, id: 1, pod: 'BRVIT', valid_from: '2026-01-01' },
        { ...base, id: 2, pod: 'Vitoria, Brazil', valid_from: '2026-07-01' },
      ],
      today,
    )
    expect(alerts.get(1)?.map((alert) => alert.label)).toEqual(['Não aplicada'])
    expect(alerts.has(2)).toBe(false)
  })

  it('does not treat different PODs or cargo modes as the same scope', () => {
    const alerts = chargeTableAlerts(
      [
        { ...base, id: 1 },
        { ...base, id: 2, pod: 'BRSSA' },
        { ...base, id: 3, cargo_mode: 'carga_solta' as const },
      ],
      today,
    )
    expect(alerts.size).toBe(0)
  })
})

describe('resolveChargeTableStates', () => {
  const row = (id: number, over: Partial<{ cargo_mode: 'container' | 'carga_solta'; pod: string; valid_from: string; active: boolean }> = {}) => ({
    id,
    cargo_mode: 'container' as const,
    pod: 'BRVIT',
    valid_from: '2026-01-01',
    valid_to: null,
    active: true,
    ...over,
  })

  it('aplica a ativa de vigência inicial mais recente e aponta quem vence (migration 274)', () => {
    const states = resolveChargeTableStates([
      row(1, { valid_from: '2025-01-01' }),
      row(2, { pod: 'BRVIX', valid_from: '2026-01-01' }),
      row(3, { active: false, valid_from: '2027-01-01' }),
      row(4, { cargo_mode: 'carga_solta' }),
    ])
    expect(states.get(2)).toEqual({ kind: 'applied' })
    expect(states.get(1)).toEqual({ kind: 'shadowed', winnerId: 2 })
    expect(states.get(3)).toEqual({ kind: 'inactive' })
    expect(states.get(4)).toEqual({ kind: 'applied' })
  })

  it('desempata pela maior id quando a vigência inicial é igual', () => {
    const states = resolveChargeTableStates([row(5), row(9)])
    expect(states.get(9)).toEqual({ kind: 'applied' })
    expect(states.get(5)).toEqual({ kind: 'shadowed', winnerId: 9 })
  })
})
