// Helpers puros para estado, rótulos e formatação do detalhe de B/L.
import type { BL, BLDetail } from '../types/database'
import { cargoModeLabel as formatCargoModeLabel, type BlCargoMode } from '../lib/cargoMode'

export type CargoMode = BlCargoMode

export function resolveCargoMode(bl?: BLDetail | null): CargoMode {
  if (bl?.cargo_mode === 'misto') return 'misto'
  if (bl?.cargo_mode === 'carga_solta') return 'carga_solta'
  if (bl?.cargo_mode === 'container') return 'container'

  // Fallback para o B/L sem modalidade conhecida. O sinal tem de ser o mesmo
  // que o banco usa (`_recalculate_bl_cargo_mode`, migrations 060/062/064):
  // itens, peso, volumes, máquinas ou cubagem de carga solta. Antes ignorava
  // volumes, máquinas e cubagem, então classificava como contêiner um B/L que
  // o banco chama de carga solta.
  const hasCntr = (bl?.bl_containers?.length ?? 0) > 0
  const hasBb = (bl?.bl_breakbulk_items?.length ?? 0) > 0
    || Number(bl?.bb_weight_ton ?? 0) > 0
    || Number(bl?.bb_packages_qty ?? 0) > 0
    || Number(bl?.bb_machine_qty ?? 0) > 0
    || Number(bl?.bb_cbm ?? 0) > 0

  if (hasCntr && hasBb) return 'misto'
  if (hasBb) return 'carga_solta'
  return 'container'
}

/**
 * Rótulo da modalidade. Há um só: a lista, o export e o detalhe escreviam
 * 'Misto' e 'Misto (CNTR + Carga Solta)' para a mesma coisa.
 */
export const cargoModeLabel = formatCargoModeLabel

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
