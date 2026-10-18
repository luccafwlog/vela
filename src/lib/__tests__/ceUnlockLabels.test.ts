import { expect, it } from 'vitest'
import { ceActionLabel, ceDocumentStatusText, cePortalRequestState, ceRequestOpenForMove, ceShortReason, ceUnlockZptText, type CeUnlockZptItem } from '../ceUnlockLabels'

const base: CeUnlockZptItem = { zpt_status: null, reasons: [], can_export: false, export_state: 'not_exported', exported_at: null, confirmed: false }

it('documento: âmbar no que pede ação, ✓ no aprovado, gênero do documento', () => {
  expect(ceDocumentStatusText('termo', null)).toEqual({ label: 'Não enviado', tone: 'default' })
  expect(ceDocumentStatusText('procuracao', null)).toEqual({ label: 'Não enviada', tone: 'default' })
  expect(ceDocumentStatusText('procuracao', 'revoked')).toEqual({ label: 'Revogada', tone: 'warning' })
  expect(ceDocumentStatusText('termo', 'changes_requested')).toEqual({ label: 'Recusado', tone: 'warning' })
  expect(ceDocumentStatusText('termo', 'approved')).toEqual({ label: 'Aprovado', tone: 'paid' })
})

it('Na ZPT mostra cada pendência uma vez: ZPT antes do impedimento, impedimento antes do envio', () => {
  expect(ceUnlockZptText({ ...base, zpt_status: 'divergent', zpt_description: 'Bloqueado', zpt_pending: ['Procuração'] }))
    .toEqual({ text: 'Divergente', tone: 'danger', title: 'Bloqueado. Pendente na ZPT: Procuração' })
  expect(ceUnlockZptText({ ...base, zpt_status: 'unlocked' }).text).toBe('Desbloqueado')
  expect(ceUnlockZptText({ ...base, reasons: ['Termo de devolução pendente, vencido ou revogado', 'CE alterado: reconferência necessária'] }))
    .toMatchObject({ text: 'CE alterado: reconferir', tone: 'warning' })
  expect(ceUnlockZptText({ ...base, reasons: ['Troca de Cliente aguarda devolução e nova cobrança'] }).text).toBe('Troca de Cliente')
  expect(ceUnlockZptText({ ...base, export_state: 'exported', exported_at: '2026-10-16T15:00:00Z' }).text).toBe('Exportado 16/10')
  expect(ceUnlockZptText({ ...base, can_export: true }).text).toBe('Apto, não exportado')
  // Requisito pendente não se repete aqui: já tem coluna própria.
  expect(ceUnlockZptText({ ...base, reasons: ['Taxas locais sem liquidação integral confirmada'] })).toMatchObject({ text: 'Não exportado', tone: 'muted' })
})

it('motivo curto: primeira frase, sem repetir o documento, cortado numa palavra', () => {
  expect(ceShortReason('A procuração anual venceu em 30/09/2026; envie a renovada com vigência até 31/12/2026.')).toBe('venceu em 30/09/2026')
  expect(ceShortReason('Procuração sem reconhecimento de firma do representante legal; envie a versão assinada.')).toBe('sem reconhecimento de firma…')
  expect(ceShortReason('Assinatura ilegível.')).toBe('assinatura ilegível')
  expect(ceShortReason('CNPJ divergente')).toBe('CNPJ divergente')
})

it('Portal: situação da solicitação no feminino, âmbar no que pede ação do Cliente', () => {
  expect(cePortalRequestState('changes_requested')).toEqual({ label: 'Correção pedida', tone: 'warning' })
  expect(cePortalRequestState('cancelled')).toEqual({ label: 'Cancelada', tone: 'muted' })
  expect(cePortalRequestState('in_review')).toEqual({ label: 'Em análise', tone: 'default' })
  expect(ceRequestOpenForMove('in_review')).toBe(true)
  expect(ceRequestOpenForMove('completed')).toBe(false)
  expect(ceActionLabel('bl_moved')).toBe('B/L passou para outra solicitação')
})
