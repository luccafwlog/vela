// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { CeUnlockRequestDetail } from '../CeUnlockRequestDetail'
import type { CeUnlockRequest } from '../../../types/ceUnlock'

vi.mock('../../ui/ConfirmDialog', () => ({
  useConfirm: () => async () => true,
  useConfirmWithReason: () => async () => 'Assinatura ausente na última página',
}))
vi.mock('../../../services/ceUnlockService', () => ({
  downloadCeUnlockDocument: vi.fn(), uploadCeUnlockDocument: vi.fn(),
}))
afterEach(cleanup)

const item = (blId: string, termo = false, procuracao = false) => ({
  bl_id: blId, ce_mercante: '123', termo, procuracao, paid: true, delivered: false, confirmed: false, can_export: false, reasons: [],
})
const doc = (id: string, type: string, status = 'uploaded', createdAt = '2026-10-01T12:00:00Z') => ({
  id, type, source: 'request', status, file_name: `${id}.pdf`, version: 3, created_at: createdAt,
})
const base = (patch: Partial<CeUnlockRequest> = {}) => ({
  id: 'request', protocol: 'CE-TEST', state: 'submitted', source: 'request', version: 5, customer_name: 'Cliente A',
  items: [item('BL-1'), item('BL-2')], events: [], documents: [doc('termo-atual', 'termo'), doc('proc-atual', 'procuracao')], ...patch,
}) as unknown as CeUnlockRequest

it('mantém o termo de devolução atual disponível para análise durante upload de substituição', () => {
  const request = base({ documents: [
    doc('old', 'termo'), doc('pending', 'termo', 'uploading', '2026-10-05T12:00:00Z'),
  ] as never })
  render(<CeUnlockRequestDetail request={request} manage onAction={async () => {}} busy={false} />)
  expect(screen.queryByText(/old.pdf/)).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Aprovar termo de devolução' })).toBeTruthy()
})

it('aprova o documento para todos os BLs do pedido, sem selecionar BL', async () => {
  const onAction = vi.fn<(action: string, payload: Record<string, unknown>) => Promise<void>>(async () => {})
  render(<CeUnlockRequestDetail request={base()} manage onAction={onAction} busy={false} />)
  expect(screen.queryByLabelText(/Analisar BL/)).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Aprovar procuração' }))
  expect(onAction).toHaveBeenCalledWith('review', expect.objectContaining({
    document_id: 'proc-atual', decision: 'approved', request_id: 'request', expected_version: 5,
  }))
  expect(onAction.mock.calls[0][1]).not.toHaveProperty('bl_ids')
})

it('recusa um documento com motivo sem tocar no outro', async () => {
  const onAction = vi.fn<(action: string, payload: Record<string, unknown>) => Promise<void>>(async () => {})
  render(<CeUnlockRequestDetail request={base()} manage onAction={onAction} busy={false} />)
  await userEvent.click(screen.getAllByRole('button', { name: 'Recusar' })[0])
  expect(onAction).toHaveBeenCalledWith('review', expect.objectContaining({
    document_id: 'termo-atual', decision: 'changes_requested', reason: 'Assinatura ausente na última página',
  }))
  expect(onAction).toHaveBeenCalledTimes(1)
})

it('não oferece aprovar o que já está aprovado em todos os BLs, mas permite recusar', () => {
  const request = base({ items: [item('BL-1', true, true), item('BL-2', true, true)] as never })
  render(<CeUnlockRequestDetail request={request} manage onAction={async () => {}} busy={false} />)
  expect(screen.queryByRole('button', { name: /^Aprovar/ })).toBeNull()
  expect(screen.getAllByRole('button', { name: 'Recusar' })).toHaveLength(2)
})

it('não há mais confirmação de desbloqueio por BL nem referência externa', () => {
  const request = base({ items: [{ ...item('BL-1', true, true), can_export: true }] as never })
  render(<CeUnlockRequestDetail request={request} manage onAction={async () => {}} busy={false} />)
  expect(screen.queryByRole('button', { name: /Confirmar desbloqueio/ })).toBeNull()
  expect(screen.getByText('Apto para envio à ZPT')).toBeTruthy()
})

it('somente leitura (Financeiro/Operações) não vê ações de análise nem cancelamento', () => {
  render(<CeUnlockRequestDetail request={base()} manage={false} onAction={async () => {}} busy={false} />)
  expect(screen.queryByRole('button', { name: /Aprovar|Recusar|Cancelar pedido/ })).toBeNull()
})
