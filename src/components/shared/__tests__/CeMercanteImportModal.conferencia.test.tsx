// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../../services/supabase', () => ({ supabase: {} }))

import { BillingProgress, ServerPreviewSection } from '../CeMercanteImportModal'
import type { CePreviewRow } from '../../../services/ceMercanteImport'

function statusNote(row: CePreviewRow): string {
  const preview = { rows: [row], errors: [], warnings: [], changes: 0, moves: 0, needs_confirmation: false, manifesto: { numero: null, exists: false } }
  const { container, unmount } = render(<ServerPreviewSection preview={preview} />)
  const text = container.querySelector('tbody tr td:last-child')?.textContent ?? ''
  unmount()
  return text
}

afterEach(cleanup)

describe('Conferência com o que já está gravado', () => {
  it('mostra a nota de Portal por B/L (CEB-D05)', () => {
    expect(statusNote({ row: 1, bl_id: 'A', status: 'new', portal_visible: true })).toBe('Grava o CE · visível no Portal')
    expect(statusNote({ row: 2, bl_id: 'B', status: 'same', portal_visible: false })).toBe('Sem mudança · fora do Portal')
    expect(statusNote({ row: 3, bl_id: 'C', status: 'same' })).toBe('Sem mudança')
  })

  it('diz que o reenvio do Comunicado fica pendente (CEB-D03)', () => {
    const note = statusNote({ row: 1, bl_id: 'A', status: 'change', comunicado_sent: true })
    expect(note).toContain('o reenvio do Comunicado fica pendente (alerta)')
    expect(note).not.toContain('será reenviado')
  })
})

describe('Resultado: emissão das faturas (CEB-D10)', () => {
  it('lista por B/L o que foi faturado, retido e pulado, com o motivo', () => {
    render(
      <BillingProgress
        onResume={() => undefined}
        billing={{
          total: 5,
          remaining: [],
          error: null,
          running: false,
          results: [
            { bl_id: 'BL-FAT', status: 'invoiced', reason: 'invoiced', invoice_number: 'FAT-10' },
            { bl_id: 'BL-RET', status: 'held', reason: 'portal_not_provisioned' },
            { bl_id: 'BL-CANC', status: 'skipped', reason: 'invoice_cancelled_awaiting_emitir' },
            { bl_id: 'BL-SEMCE', status: 'skipped', reason: 'no_ce_or_cancelled' },
            { bl_id: 'BL-ZERO', status: 'skipped', reason: 'nothing_to_bill' },
          ],
        }}
      />,
    )
    const faturados = screen.getByText('Faturados').closest('.app-import-notice') as HTMLElement
    expect(within(faturados).getByText('BL-FAT: fatura FAT-10')).toBeTruthy()
    const retidos = screen.getByText('Retidos').closest('.app-import-notice') as HTMLElement
    expect(within(retidos).getByText('BL-RET: Retido: a Conta do Portal do Cliente não está ativa.')).toBeTruthy()
    const pulados = screen.getByText('Pulados').closest('.app-import-notice') as HTMLElement
    expect(within(pulados).getByText('BL-CANC: Pulado: a fatura foi cancelada e aguarda Emitir na ficha do B/L.')).toBeTruthy()
    expect(within(pulados).getByText('BL-SEMCE: Pulado: B/L sem CE Mercante ou cancelado.')).toBeTruthy()
    expect(within(pulados).queryByText(/BL-ZERO/)).toBeNull()
  })
})
