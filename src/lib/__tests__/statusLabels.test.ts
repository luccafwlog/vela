import { describe, expect, it } from 'vitest'
import { ESTADO_CONCILIACAO_META, VOYAGE_STATUS_BADGE_TONE } from '../statusLabels'

describe('ESTADO_CONCILIACAO_META', () => {
  it('tem entradas para divergente, incompleto e conciliado', () => {
    expect(ESTADO_CONCILIACAO_META.divergente.label).toBe('Divergente')
    expect(ESTADO_CONCILIACAO_META.incompleto.label).toBe('Pendente')
    expect(ESTADO_CONCILIACAO_META.conciliado.label).toBe('Conciliado')
  })

  it('usa variáveis CSS (var(--app-*)) para cor e fundo, nunca hex', () => {
    const entries = Object.values(ESTADO_CONCILIACAO_META)
    for (const meta of entries) {
      expect(meta.color).toMatch(/^var\(--app-/)
      expect(meta.bg).toMatch(/^var\(--app-/)
    }
  })

  it('cada entrada tem classe de badge para uso no componente Badge', () => {
    expect(ESTADO_CONCILIACAO_META.divergente.badgeTone).toBe('red')
    expect(ESTADO_CONCILIACAO_META.incompleto.badgeTone).toBe('yellow')
    expect(ESTADO_CONCILIACAO_META.conciliado.badgeTone).toBe('green')
  })
})

describe('VOYAGE_STATUS_BADGE_TONE', () => {
  it('mapeia status de viagem para tons de badge', () => {
    expect(VOYAGE_STATUS_BADGE_TONE.active).toBe('blue')
    expect(VOYAGE_STATUS_BADGE_TONE.completed).toBe('green')
    expect(VOYAGE_STATUS_BADGE_TONE.cancelled).toBe('red')
  })
})
