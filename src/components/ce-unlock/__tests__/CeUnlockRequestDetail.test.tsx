// @vitest-environment jsdom
import { cleanup, render as rtlRender, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { CeUnlockRequestDetail as Detail } from '../CeUnlockRequestDetail'
import { ceUnlockMissing } from '../../../lib/ceUnlockLabels'
import type { CeUnlockDocument, CeUnlockRequest } from '../../../types/ceUnlock'

vi.mock('../../ui/ConfirmDialog', () => ({
  useConfirm: () => async () => true,
  useConfirmWithReason: () => async () => 'Assinatura ausente na última página',
}))
vi.mock('../../../services/ceUnlockService', () => ({
  downloadCeUnlockDocument: vi.fn(async () => {}), uploadCeUnlockDocument: vi.fn(),
}))
afterEach(cleanup)
const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>)
const CeUnlockRequestDetail = Detail

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

it('mantém o termo de devolução atual disponível para análise durante upload de substituição', async () => {
  const request = base({ documents: [
    doc('old', 'termo'), doc('pending', 'termo', 'uploading', '2026-10-05T12:00:00Z'),
  ] as never })
  render(<CeUnlockRequestDetail request={request} manage onAction={async () => {}} busy={false} />)
  expect(screen.getByRole('button', { name: 'old.pdf' })).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Analisar termo de devolução' }))
  expect(screen.getByRole('button', { name: 'Aprovar termo de devolução' })).toBeTruthy()
})

it('um único botão Analisar por documento; abre Aprovar, Recusar e Voltar no bloco e aprova para todos os B/Ls', async () => {
  const onAction = vi.fn<(action: string, payload: Record<string, unknown>) => Promise<void>>(async () => {})
  render(<CeUnlockRequestDetail request={base()} manage onAction={onAction} busy={false} />)
  expect(screen.queryByRole('button', { name: /^Aprovar/ })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Analisar procuração' }))
  const block = screen.getByRole('region', { name: 'Analisar procuração' })
  expect(within(block).getByRole('button', { name: 'Abrir proc-atual.pdf' })).toBeTruthy()
  expect(within(block).getByRole('button', { name: 'Voltar' })).toBeTruthy()
  await userEvent.click(within(block).getByRole('button', { name: 'Aprovar procuração' }))
  expect(onAction).toHaveBeenCalledWith('review', expect.objectContaining({
    document_id: 'proc-atual', decision: 'approved', request_id: 'request', expected_version: 5,
  }))
  expect(onAction.mock.calls[0][1]).not.toHaveProperty('bl_ids')
  expect(screen.queryByRole('region', { name: 'Analisar procuração' })).toBeNull()
})

it('recusa um documento com motivo sem tocar no outro', async () => {
  const onAction = vi.fn<(action: string, payload: Record<string, unknown>) => Promise<void>>(async () => {})
  render(<CeUnlockRequestDetail request={base()} manage onAction={onAction} busy={false} />)
  await userEvent.click(screen.getByRole('button', { name: 'Analisar termo de devolução' }))
  await userEvent.click(screen.getByRole('button', { name: 'Recusar…' }))
  expect(onAction).toHaveBeenCalledWith('review', expect.objectContaining({
    document_id: 'termo-atual', decision: 'changes_requested', reason: 'Assinatura ausente na última página',
  }))
  expect(onAction).toHaveBeenCalledTimes(1)
})

it('documento aprovado não oferece Analisar: recusar a aprovação fica no menu ⋮', async () => {
  const onAction = vi.fn<(action: string, payload: Record<string, unknown>) => Promise<void>>(async () => {})
  const request = base({
    items: [item('BL-1', true, true), item('BL-2', true, true)] as never,
    documents: [doc('termo-atual', 'termo', 'approved'), doc('proc-atual', 'procuracao', 'approved')] as never,
  })
  render(<CeUnlockRequestDetail request={request} manage onAction={onAction} busy={false} />)
  expect(screen.queryByRole('button', { name: /^Analisar/ })).toBeNull()
  expect(screen.getAllByText('Aprovado').length + screen.getAllByText('Aprovada').length).toBe(2)
  await userEvent.click(screen.getByRole('button', { name: 'Ações de termo de devolução' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Recusar aprovação' }))
  expect(onAction).toHaveBeenCalledWith('review', expect.objectContaining({ document_id: 'termo-atual', decision: 'changes_requested' }))
})

it('B/Ls da solicitação mostram os requisitos com ícones e só o estado da ZPT', () => {
  const request = base({ items: [{ ...item('BL-1', true, true), can_export: true, export_state: 'not_exported' }] as never })
  render(<CeUnlockRequestDetail request={request} manage onAction={async () => {}} busy={false} />)
  expect(screen.queryByRole('button', { name: /Confirmar desbloqueio/ })).toBeNull()
  expect(screen.getByText('Apto, não exportado')).toBeTruthy()
  expect(screen.getByRole('img', { name: 'B/L original BL-1: pendente' })).toBeTruthy()
})

it('CE alterado aparece uma vez na coluna Na ZPT, com Reconferir CE', async () => {
  const onAction = vi.fn<(action: string, payload: Record<string, unknown>) => Promise<void>>(async () => {})
  const request = base({ items: [{ ...item('BL-1', true, true), reasons: ['CE alterado: reconferência necessária'] }] as never })
  render(<CeUnlockRequestDetail request={request} manage onAction={onAction} busy={false} />)
  expect(screen.getByText('CE alterado: reconferir')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Reconferir CE' }))
  expect(onAction).toHaveBeenCalledWith('reconfirm_ce', expect.objectContaining({ bl_id: 'BL-1' }))
})

it('somente leitura (Financeiro/Operações) não vê ações de análise nem cancelamento', () => {
  render(<CeUnlockRequestDetail request={base()} manage={false} onAction={async () => {}} busy={false} />)
  expect(screen.queryByRole('button', { name: /Analisar|Aprovar|Recusar|Cancelar pedido/ })).toBeNull()
})

it('Histórico em tabela aberta com quem fez e o motivo', () => {
  const request = base({ events: [
    { id: 1, action: 'review', reason: 'Assinatura ausente na página 2', created_at: '2026-10-14T07:00:00Z', actor: 'Ana Ribeiro' },
    { id: 2, action: 'submit', reason: null, created_at: '2026-10-16T12:00:00Z', actor: 'Cliente pelo Portal' },
  ] })
  render(<CeUnlockRequestDetail request={request} manage onAction={async () => {}} busy={false} />)
  const history = screen.getByRole('region', { name: 'Histórico' })
  expect(within(history).getByText('2 registros')).toBeTruthy()
  expect(within(history).getByRole('columnheader', { name: 'Por' })).toBeTruthy()
  expect(within(history).getByText('Ana Ribeiro')).toBeTruthy()
  expect(within(history).getByText('Assinatura ausente na página 2')).toBeTruthy()
  expect(document.querySelector('details')).toBeNull()
})

it('diz o que falta na solicitação', () => {
  expect(ceUnlockMissing({ state: 'in_review', items: [{ termo: true, procuracao: false, paid: true, delivered: true }] as never }))
    .toBe('falta aprovar a procuração')
  expect(ceUnlockMissing({ state: 'in_review', items: [{ termo: false, procuracao: false, paid: false, delivered: true }] as never }))
    .toBe('falta aprovar o termo de devolução e a procuração; liquidar as taxas locais')
  expect(ceUnlockMissing({ state: 'completed', items: [{ termo: true, procuracao: true, paid: true, delivered: true }] as never })).toBeNull()
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

it("documentos em tabela: o nome do arquivo abre; versões anteriores numa linha no pé, com o motivo", async () => {
  const { downloadCeUnlockDocument } = await import("../../../services/ceUnlockService");
  render(<CeUnlockRequestDetail request={versionRequest(versionDocs)} manage busy={false} onAction={vi.fn()} />);
  expect(screen.getByRole("button", { name: "termo-v2.pdf" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "procuracao.pdf" })).toBeTruthy();
  const previous = screen.getByRole("region", { name: "Versões anteriores dos documentos" });
  expect(previous.textContent).toMatch(/Versão anterior de termo de devolução: termo-v1\.pdf, enviada em 10\/10\/2026, recusado \(Assinatura ilegível\)\./);
  expect(within(previous).queryByRole("button", { name: /Analisar|Aprovar|Recusar/ })).toBeNull();
  await userEvent.click(within(previous).getByRole("button", { name: "termo-v1.pdf" }));
  expect(downloadCeUnlockDocument).toHaveBeenCalledWith("t1");
});

it("versão anterior já expurgada mostra texto em vez de link", () => {
  const purged = [versionDocs[0], { ...versionDocs[1], purged: true }, versionDocs[2]];
  render(<CeUnlockRequestDetail request={versionRequest(purged)} manage busy={false} onAction={vi.fn()} />);
  const previous = screen.getByRole("region", { name: "Versões anteriores dos documentos" });
  expect(within(previous).getByText(/arquivo removido pela regra de retenção/)).toBeTruthy();
  expect(within(previous).queryByRole("button")).toBeNull();
});

it("versão reivindicada pelo expurgo, ainda não removida, não se diz removida nem oferece abrir", () => {
  const pending = [versionDocs[0], { ...versionDocs[1], cleanup_pending: true }, versionDocs[2]];
  render(<CeUnlockRequestDetail request={versionRequest(pending)} manage busy={false} onAction={vi.fn()} />);
  const previous = screen.getByRole("region", { name: "Versões anteriores dos documentos" });
  expect(within(previous).getByText(/arquivo em remoção pela regra de retenção/)).toBeTruthy();
  expect(within(previous).queryByText(/removido/)).toBeNull();
  expect(within(previous).queryByRole("button")).toBeNull();
});

it("sem substituições, ou em pedido VIP, não mostra versões anteriores", () => {
  render(<CeUnlockRequestDetail request={versionRequest([versionDocs[0], versionDocs[2]])} manage busy={false} onAction={vi.fn()} />);
  expect(screen.queryByRole("region", { name: "Versões anteriores dos documentos" })).toBeNull();
  cleanup();
  render(<CeUnlockRequestDetail request={versionRequest(versionDocs, "vip_annual")} manage busy={false} onAction={vi.fn()} />);
  expect(screen.queryByRole("region", { name: "Versões anteriores dos documentos" })).toBeNull();
});
