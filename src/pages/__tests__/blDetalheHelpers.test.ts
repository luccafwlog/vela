import { describe, expect, it } from 'vitest'
import {
  cargoModeLabel,
  formatNumber,
  resolveCargoMode,
  resolveChargeLineStatusLabel,
  resolveChargeLineStatusTone,
  resolveChargeStatusLabel,
  resolveChargeStatusTone,
} from '../blDetalheHelpers'
import type { BLDetail } from '../../types/database'

describe('resolveCargoMode', () => {
  it('respeita cargo_mode explícito', () => {
    expect(resolveCargoMode({ cargo_mode: 'carga_solta' } as BLDetail)).toBe('carga_solta')
    expect(resolveCargoMode({ cargo_mode: 'container' } as BLDetail)).toBe('container')
  })

  it('infere carga_solta quando há itens de break-bulk', () => {
    expect(resolveCargoMode({ cargo_mode: null, bl_breakbulk_items: [{}] } as unknown as BLDetail)).toBe('carga_solta')
  })

  it('default é container (inclui null/undefined)', () => {
    expect(resolveCargoMode(null)).toBe('container')
    expect(resolveCargoMode(undefined)).toBe('container')
    expect(resolveCargoMode({ cargo_mode: null, bl_breakbulk_items: [] } as unknown as BLDetail)).toBe('container')
  })
})

describe('cargoModeLabel', () => {
  it('rotula os modos', () => {
    expect(cargoModeLabel('carga_solta')).toBe('Carga Solta')
    expect(cargoModeLabel('container')).toBe('Container')
  })
})

describe('formatNumber', () => {
  it('formata em pt-BR e trata não-numéricos', () => {
    expect(formatNumber(1234.5)).toBe((1234.5).toLocaleString('pt-BR'))
    expect(formatNumber(null)).toBe('0')
    expect(formatNumber(undefined)).toBe('0')
    expect(formatNumber('abc')).toBe('0')
  })
})

describe('resolveChargeStatusTone', () => {
  it('mapeia status de cobrança para tom', () => {
    expect(resolveChargeStatusTone('review_required')).toBe('yellow')
    expect(resolveChargeStatusTone('ready_for_billing')).toBe('green')
    expect(resolveChargeStatusTone('reviewed')).toBe('green')
    expect(resolveChargeStatusTone('calculated')).toBe('blue')
    expect(resolveChargeStatusTone('exempt')).toBe('slate')
    expect(resolveChargeStatusTone(null)).toBe('blue')
  })
})

describe('resolveChargeStatusLabel', () => {
  it('rotula todos os status conhecidos e o default', () => {
    expect(resolveChargeStatusLabel('calculated')).toBe('Calculado (provisório)')
    expect(resolveChargeStatusLabel('review_required')).toBe('Revisão obrigatória')
    expect(resolveChargeStatusLabel('reviewed')).toBe('Revisado')
    expect(resolveChargeStatusLabel('ready_for_billing')).toBe('Pronto para faturar')
    expect(resolveChargeStatusLabel('exempt')).toBe('Isento')
    expect(resolveChargeStatusLabel(null)).toBe('Não calculado')
  })
})

describe('resolveChargeLineStatus*', () => {
  it('tom da linha de cobrança', () => {
    expect(resolveChargeLineStatusTone('review_required')).toBe('yellow')
    expect(resolveChargeLineStatusTone('exempt')).toBe('slate')
    expect(resolveChargeLineStatusTone('reviewed')).toBe('green')
    expect(resolveChargeLineStatusTone(null)).toBe('blue')
  })

  it('rótulo curto da linha de cobrança', () => {
    expect(resolveChargeLineStatusLabel('calculated')).toBe('Provisório')
    expect(resolveChargeLineStatusLabel('review_required')).toBe('Revisão')
    expect(resolveChargeLineStatusLabel('ready_for_billing')).toBe('Pronto')
    expect(resolveChargeLineStatusLabel('exempt')).toBe('Isento')
    expect(resolveChargeLineStatusLabel(null)).toBe('Pendente')
  })
})
