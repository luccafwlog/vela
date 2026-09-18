import { describe, expect, it } from 'vitest'
import { formatBlCargoBadge } from '../blCargoBadge'
import type { BLListItem } from '../../types/database'

function makeBl(partial: Partial<BLListItem>): BLListItem {
  return { id: 'BL-1', cargo_mode: 'container', ...partial } as BLListItem
}

describe('formatBlCargoBadge', () => {
  it('conta contêineres distintos em B/L de contêiner', () => {
    const badge = formatBlCargoBadge(makeBl({
      bl_containers: [{ container_number: 'CNTR1' }, { container_number: 'CNTR1' }, { container_number: 'CNTR2' }],
    } as Partial<BLListItem>))
    expect(badge).toBe('2 CNTR')
  })

  it('escreve o peso no locale pt-BR, com vírgula decimal e separador de milhar', () => {
    // `toFixed(1)` escrevia `12.3` numa tela que formata tudo como `12,3`, e
    // `135263 ton` sem separador — o formato que ajudou um peso mil vezes maior
    // a passar despercebido.
    expect(formatBlCargoBadge(makeBl({ cargo_mode: 'carga_solta', bb_weight_ton: 12.35 }))).toBe('12,35 ton')
    expect(formatBlCargoBadge(makeBl({ cargo_mode: 'carga_solta', bb_weight_ton: 135263 }))).toBe('135.263 ton')
  })

  it('não trunca as três casas que o B/L declara', () => {
    expect(formatBlCargoBadge(makeBl({ cargo_mode: 'carga_solta', bb_weight_ton: 259.312 }))).toBe('259,312 ton')
  })

  it('cai para volumes e depois para itens quando não há peso', () => {
    expect(formatBlCargoBadge(makeBl({ cargo_mode: 'carga_solta', bb_packages_qty: 8 }))).toBe('8 vol')
    expect(formatBlCargoBadge(makeBl({
      cargo_mode: 'carga_solta',
      bl_breakbulk_items: [{ id: 1 }, { id: 2 }],
    } as Partial<BLListItem>))).toBe('2 itens')
    expect(formatBlCargoBadge(makeBl({
      cargo_mode: 'carga_solta',
      bl_breakbulk_items: [{ id: 1 }],
    } as Partial<BLListItem>))).toBe('1 item')
  })

  it('soma as duas lentes no B/L misto', () => {
    const badge = formatBlCargoBadge(makeBl({
      cargo_mode: 'misto',
      bb_weight_ton: 12,
      bl_containers: [{ container_number: 'CNTR1' }],
    } as Partial<BLListItem>))
    expect(badge).toBe('1 CNTR + 12 ton')
  })

  it('B/L misto sem número de contêiner legível mostra a carga solta, nunca "0 CNTR"', () => {
    // O ramo `misto` anterior escapava para o `return` final quando a contagem
    // de contêineres distintos era zero, e imprimia "0 CNTR" — descartando a
    // carga solta que o B/L comprovadamente tem.
    const badge = formatBlCargoBadge(makeBl({
      cargo_mode: 'misto',
      bb_weight_ton: 38,
      bl_containers: [{ container_number: '   ' }],
    } as Partial<BLListItem>))
    expect(badge).toBe('38 ton')
    expect(badge).not.toContain('0 CNTR')
  })
})
