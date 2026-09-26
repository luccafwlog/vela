// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../services/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))

import { EscalaModal, type EscalaModalData } from '../../shared/VoyageScheduleModals'
import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'

afterEach(cleanup)

// Espelha o que VoyageVisaoTab.buildEscalaModalData(null) monta ao clicar em
// "Adicionar escala": sem linha existente, todos os campos nascem vazios.
const novaEscala: EscalaModalData = {
  voyageId: 9,
  voyageLabel: 'NAVIO 456S',
  port: null,
  temImportacao: true,
  eta: null,
  ata: null,
  ceStatus: 'waiting',
  linked: null,
  escalaNumber: null,
  exportExistingId: null,
  temExportacao: false,
  hasGranite: false,
  hasEmpty: false,
  containersQty: null,
  movementsQty: null,
  dischargePorts: [],
  exportLocked: false,
}

describe('EscalaModal — escala nova', () => {
  it('persiste tem_importacao=true, o mesmo modo que a tela exibe', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(
      <ConfirmDialogProvider>
        <EscalaModal open escala={novaEscala} onClose={() => {}} onSaved={onSaved} />
      </ConfirmDialogProvider>,
    )

    await user.type(screen.getByLabelText('Porto da escala'), 'BRSSZ')
    await user.click(screen.getByRole('button', { name: 'Adicionar escala' }))

    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onSaved.mock.calls[0][0].temImportacao).toBe(true)
  })
})

describe('EscalaModal — ATD derivado', () => {
  function renderComAtracacoes(
    terminals: Array<{ terminalId: string | null; terminalCode: string | null; atd: string | null }>,
    estado: { loading?: boolean; error?: string | null } = {},
  ) {
    const escala: EscalaModalData = {
      ...novaEscala,
      port: 'BRVIX',
      terminalScale: {
        voyageId: 9,
        port: 'BRVIX',
        portId: 99,
        revision: 1,
        loading: estado.loading ?? false,
        error: estado.error ?? null,
        fronts: [],
        tbcFronts: [],
        terminals: terminals.map((terminal) => ({
          terminalId: terminal.terminalId,
          terminalCode: terminal.terminalCode,
          etb: null,
          atb: null,
          etd: null,
          atd: terminal.atd,
          restow: null,
          reportId: null,
        })),
        activeTerminals: [],
        historicalTerminals: [],
        agencyReports: [],
      },
    }
    render(
      <ConfirmDialogProvider>
        <EscalaModal open escala={escala} onClose={() => {}} onSaved={vi.fn()} />
      </ConfirmDialogProvider>,
    )
  }

  it('nomeia a Atracação de origem e formata a data quando todas desatracaram', () => {
    renderComAtracacoes([
      { terminalId: 't-tvv', terminalCode: 'TVV', atd: '2026-08-29' },
      { terminalId: 't-portmac', terminalCode: 'PORTMAC', atd: '2026-09-02' },
    ])
    expect((screen.getByLabelText('ATD derivado') as HTMLInputElement).value).toBe('02/09/2026')
    expect(screen.getByText('Derivado da última Atracação — PORTMAC.')).toBeTruthy()
  })

  it('nomeia o terminal que falta quando o ATD ainda nao existe', () => {
    renderComAtracacoes([
      { terminalId: 't-tvv', terminalCode: 'TVV', atd: '2026-08-29' },
      { terminalId: 't-portmac', terminalCode: 'PORTMAC', atd: null },
    ])
    expect((screen.getByLabelText('ATD derivado') as HTMLInputElement).value).toBe('—')
    expect(screen.getByText('Aguardando o ATD de PORTMAC.')).toBeTruthy()
  })

  it('chama de TBC a Atracação sem código de terminal, nunca pelo UUID', () => {
    renderComAtracacoes([
      { terminalId: 'd0000000-0000-4000-8000-000000000001', terminalCode: null, atd: null },
    ])
    expect(screen.getByText('Aguardando o ATD de TBC.')).toBeTruthy()
    expect(screen.queryByText(/d0000000/)).toBeNull()
  })

  it('nao afirma que a escala esta sem Atracacoes enquanto carrega', () => {
    renderComAtracacoes([], { loading: true })
    expect(screen.getByText('Carregando as Atracações desta escala…')).toBeTruthy()
  })

  it('nao afirma que a escala esta sem Atracacoes quando a leitura falha', () => {
    renderComAtracacoes([], { error: 'falha de rede' })
    expect(screen.getByText('Não foi possível ler as Atracações desta escala.')).toBeTruthy()
  })
})
