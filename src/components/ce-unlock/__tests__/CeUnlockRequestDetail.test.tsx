// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { CeUnlockRequestDetail } from '../CeUnlockRequestDetail'
import type { CeUnlockDocument, CeUnlockRequest } from '../../../types/ceUnlock'

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

const versionDoc = (over: Partial<CeUnlockDocument>): CeUnlockDocument => ({
  id: "d", version: 1, customer_id: 1, request_id: "req-1", type: "termo", source: "request", status: "uploaded",
  file_name: "termo.pdf", size_bytes: 10, valid_from: null, valid_until: null, coverage_year: null, reason: null,
  created_at: "2026-10-10T13:00:00Z", ...over,
});
const versionRequest = (documents: CeUnlockDocument[], source: CeUnlockRequest["source"] = "request"): CeUnlockRequest => ({
  id: "req-1", protocol: "CE-1", state: "in_review", version: 2, source, items: [], documents, events: [],
});
const versionDocs = [
  versionDoc({ id: "t2", file_name: "termo-v2.pdf", created_at: "2026-10-11T13:00:00Z" }),
  versionDoc({ id: "t1", file_name: "termo-v1.pdf", status: "changes_requested", reason: "Assinatura ilegível" }),
  versionDoc({ id: "p1", type: "procuracao", file_name: "procuracao.pdf", status: "approved" }),
];

it("análise interna mostra só a versão atual de cada documento e lista as versões anteriores com situação, data e motivo", () => {
  render(<CeUnlockRequestDetail request={versionRequest(versionDocs)} manage busy={false} onAction={vi.fn()} />);
  expect(screen.getByText("termo-v2.pdf")).toBeTruthy();
  expect(screen.getByText("procuracao.pdf")).toBeTruthy();
  const previous = screen.getByRole("list", { name: "Versões anteriores dos documentos" });
  const items = within(previous).getAllByRole("listitem");
  expect(items).toHaveLength(1);
  expect(items[0].textContent).toContain("termo-v1.pdf");
  expect(items[0].textContent).toContain("Correção solicitada");
  expect(items[0].textContent).toContain("10/10/2026");
  expect(items[0].textContent).toContain("Motivo: Assinatura ilegível");
  // A versão anterior não ganha botões de análise.
  expect(screen.getAllByRole("button", { name: "Abrir documento" })).toHaveLength(2);
});

it("sem substituições, ou em pedido VIP, não mostra versões anteriores", () => {
  render(<CeUnlockRequestDetail request={versionRequest([versionDocs[0], versionDocs[2]])} manage busy={false} onAction={vi.fn()} />);
  expect(screen.queryByText("Versões anteriores")).toBeNull();
  cleanup();
  render(<CeUnlockRequestDetail request={versionRequest(versionDocs, "vip_annual")} manage busy={false} onAction={vi.fn()} />);
  expect(screen.queryByText("Versões anteriores")).toBeNull();
});
