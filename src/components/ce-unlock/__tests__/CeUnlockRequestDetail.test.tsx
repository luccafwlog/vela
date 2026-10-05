// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { CeUnlockRequestDetail } from '../CeUnlockRequestDetail'
import type { CeUnlockRequest } from '../../../types/ceUnlock'

vi.mock('../../ui/ConfirmDialog', () => ({
  useConfirm: () => async () => true,
  useConfirmWithReason: () => async () => 'Referência interna',
}))
vi.mock('../../../services/ceUnlockService', () => ({
  downloadCeUnlockDocument: vi.fn(), uploadCeUnlockDocument: vi.fn(),
}))

it('mantém o termo atual disponível para análise durante upload de substituição', () => {
  const request = {
    id: 'request', protocol: 'CE-TEST', state: 'submitted', source: 'request',
    items: [], events: [], documents: [
      { id: 'old', type: 'termo', source: 'request', status: 'uploaded', file_name: 'termo-atual.pdf', created_at: '2026-10-01T12:00:00Z' },
      { id: 'pending', type: 'termo', source: 'request', status: 'uploading', file_name: 'substituto.pdf', created_at: '2026-10-05T12:00:00Z' },
    ],
  } as unknown as CeUnlockRequest
  render(<CeUnlockRequestDetail request={request} manage onAction={async () => {}} busy={false} />)
  expect(screen.queryByText(/termo-atual.pdf/)).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Aprovar termo' })).toBeTruthy()
})
