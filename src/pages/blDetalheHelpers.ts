// Helpers puros para estado, rótulos e formatação do detalhe de B/L.
import type { BL, BLDetail } from '../types/database'

export type CargoMode = 'container' | 'carga_solta' | 'misto'

export function resolveCargoMode(bl?: BLDetail | null): CargoMode {
  if (bl?.cargo_mode === 'misto') return 'misto'
  if (bl?.cargo_mode === 'carga_solta') return 'carga_solta'
  if (bl?.cargo_mode === 'container') return 'container'
  const hasCntr = (bl?.bl_containers?.length ?? 0) > 0
  const hasBb = (bl?.bl_breakbulk_items?.length ?? 0) > 0 || Number(bl?.bb_weight_ton ?? 0) > 0
  if (hasCntr && hasBb) return 'misto'
  if (hasBb) return 'carga_solta'
  return 'container'
}

export function cargoModeLabel(mode: CargoMode) {
  if (mode === 'misto') return 'Misto (CNTR + Carga Solta)'
  return mode === 'carga_solta' ? 'Carga Solta' : 'Container'
}

export function formatNumber(value: number | string | null | undefined) {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount.toLocaleString('pt-BR') : '0'
}

// Etapa 3 do plano de faturamento (ADR 0038, decisão 8): 'calculated' e
// 'ready_for_billing' pararam de coincidir na prática (migration 263 remove a
// promoção automática) — o tom e o rótulo precisam distinguir a fase
// provisória (calculado, ainda não confirmado) da fase confirmada (pronta
// para faturar via CE Mercante ou clique explícito).
export function resolveChargeStatusTone(status: BL['charge_status']) {
  if (status === 'review_required') return 'yellow'
  if (status === 'ready_for_billing' || status === 'reviewed') return 'green'
  if (status === 'calculated') return 'blue'
  if (status === 'exempt') return 'slate'
  return 'blue'
}

export function resolveChargeStatusLabel(status: BL['charge_status']) {
  switch (status) {
    case 'calculated':
      return 'Calculado (provisório)'
    case 'review_required':
      return 'Revisao obrigatoria'
    case 'reviewed':
      return 'Revisado'
    case 'ready_for_billing':
      return 'Pronto para faturar'
    case 'exempt':
      return 'Isento'
    default:
      return 'Não calculado'
  }
}

export function resolveChargeLineStatusTone(status: string | null) {
  if (status === 'review_required') return 'yellow'
  if (status === 'exempt') return 'slate'
  if (status === 'reviewed' || status === 'ready_for_billing') return 'green'
  if (status === 'calculated') return 'blue'
  return 'blue'
}

export function resolveChargeLineStatusLabel(status: string | null) {
  switch (status) {
    case 'calculated':
      return 'Provisório'
    case 'review_required':
      return 'Revisao'
    case 'reviewed':
      return 'Revisado'
    case 'ready_for_billing':
      return 'Pronto'
    case 'exempt':
      return 'Isento'
    default:
      return 'Pendente'
  }
}
