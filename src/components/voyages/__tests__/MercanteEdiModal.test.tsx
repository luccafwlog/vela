// @vitest-environment jsdom
import { cleanup, fireEvent, render as renderDom, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MercanteCargoInput, MercanteVaziosInput } from '../../../services/mercanteEdiData'

const state = vi.hoisted(() => ({ data: undefined as unknown, register: vi.fn() }))

vi.mock('../../../hooks/useManifestosMercante', () => ({
  useMercanteEdiInput: () => ({ data: state.data, isLoading: false, error: null }),
}))
vi.mock('../../../services/mercanteEdiData', () => ({ registerMercanteEdiFile: state.register }))

import { MercanteEdiModal } from '../MercanteEdiModal'

function render(ui: ReactElement) {
  return renderDom(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)
}

const header = {
  carrierCode: 'CN001321',
  closingDate: '2026-09-30',
  operationDate: '2026-11-09',
  pol: 'CNTAC',
  pod: 'BRVIX',
  voyageNumber: '6',
  vesselImo: '1095014',
  terminalCode: 'BRVIX004',
  terminalDepot: 'TVV',
}

const bl = {
  id: 'CSC45640602Q00',
  consigneeBlock: 'ACME LOGISTICA LTDA\nRUA X 10 VILA VELHA ES',
  consigneeCnpj: '28772926000114',
  shipperBlock: 'SHIPPER CO., LTD.',
  notifyBlock: 'SAME AS CONSIGNEE',
  notifyCnpj: null,
  emissionDate: '2026-09-25',
  description: 'TEXTILE PIECE GOODS\nNCM: 5407',
  totalPackages: 10,
  packagesUnit: 'ROLLS',
  totalCbm: 68,
  movementFrom: 'FCL/FCL',
  ncmCodes: ['5407'],
  freightLines: [{ category: 'OCEAN_FREIGHT', description: 'OCEAN FREIGHT', currency: 'USD', amount: 8500, payment: 'PREPAID' }],
  terminalCode: null,
  terminalDepot: null,
  containers: [{ number: 'ABCU1234567', type: '40HC', grossKg: 25480, tareKg: 3700, cbm: 68, seal: '134543', isImo: false, imoClass: null, unNumber: null, shared: false }],
  breakbulkItems: [],
  vehicles: [],
}

function cargo(overrides: Partial<MercanteCargoInput> = {}): MercanteCargoInput {
  return { vesselName: 'GREEN GUANGZHOU', voyageNumber: '6', hasBaplie: true, header, bls: [bl], skippedBls: [], ...overrides }
}

const route = { pol: 'CNTAC', pod: 'BRVIX', label: 'Taicang → Vitória', kind: 'carga' as const }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Gerar EDI Mercante (Rotas e Manifestos)', () => {
  it('rota completa: registra no Histórico e baixa com o número do Vela e a sigla do navio e da viagem', async () => {
    state.data = cargo()
    state.register.mockResolvedValue({ number: 7, fileName: 'FWL_MERCANTE_000007_GG6.TXT', generatedAt: '2026-11-06T12:00:00Z' })
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:edi')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<MercanteEdiModal voyageId={169} route={route} onClose={vi.fn()} />)

    expect(screen.getByText('CNTAG → BRVIX')).toBeTruthy()
    expect(screen.getByText(/Pronto para baixar/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
    expect(state.register).toHaveBeenCalledWith({ voyageId: 169, pol: 'CNTAC', pod: 'BRVIX', mode: 'container', tag: 'GG6', blCount: 1, itemCount: 1 })
    const link = click.mock.contexts[0] as HTMLAnchorElement
    expect(link.download).toBe('FWL_MERCANTE_000007_GG6.TXT')
    // TXT sem BOM: os primeiros bytes são o tipo do registro M5, não EF BB BF.
    const blob = createObjectURL.mock.calls[0][0]
    expect(blob.type).toBe('text/plain;charset=utf-8')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(String.fromCharCode(...bytes.slice(0, 2))).toBe('M5')
  })

  it('sem o registro no Histórico, nada é baixado e a recusa aparece', async () => {
    state.data = cargo()
    state.register.mockRejectedValue(new Error('Gerar EDI Mercante é só da conta Dev.'))
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:edi')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    render(<MercanteEdiModal voyageId={169} route={route} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('impedimento bloqueia o download e aparece junto ao B/L', () => {
    state.data = cargo({ bls: [{ ...bl, consigneeCnpj: null }] })
    render(<MercanteEdiModal voyageId={169} route={route} onClose={vi.fn()} />)

    expect(screen.getByText(/não pode ser baixado/)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Impedimentos' }).textContent).toContain('CSC45640602Q00')
    expect((screen.getByRole('button', { name: 'Baixar arquivo' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('avisa o B/L de carga solta que fica fora e a Viagem sem Baplie', () => {
    state.data = cargo({ hasBaplie: false, skippedBls: [{ id: 'BB-1', reason: 'carga solta' }] })
    render(<MercanteEdiModal voyageId={169} route={route} onClose={vi.fn()} />)

    const avisos = screen.getByRole('region', { name: 'Avisos' }).textContent ?? ''
    expect(avisos).toContain('BB-1')
    expect(avisos).toContain('Baplie')
    expect((screen.getByRole('button', { name: 'Baixar arquivo' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('carga solta: arquivo parcial com "A completar" e download liberado', () => {
    state.data = cargo({
      bls: [{
        ...bl, id: 'BB-1', containers: [], emissionDate: null, freightLines: [], movementFrom: null,
        breakbulkItems: [{ description: 'EXCAVATOR', quantity: 1, unit: 'UNIT', grossKg: 21900, cbm: null, marks: 'SANY' }],
      }],
    })
    render(<MercanteEdiModal voyageId={169} route={{ ...route, kind: 'carga_solta' }} onClose={vi.fn()} />)

    expect(screen.getByRole('heading', { name: /EDI Mercante de carga solta/ })).toBeTruthy()
    expect(screen.getByText(/Arquivo parcial: complete os itens/)).toBeTruthy()
    const completar = screen.getByRole('region', { name: 'A completar' }).textContent ?? ''
    expect(completar).toContain('Sem data de emissão do B/L.')
    expect(completar).toContain('Sem valor do frete marítimo')
    expect(screen.queryByRole('region', { name: 'Impedimentos' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Baixar arquivo' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('linha VAZIOS gera o arquivo de vazios', () => {
    const vazios: MercanteVaziosInput = {
      vesselName: 'GREEN GUANGZHOU', voyageNumber: '6', hasBaplie: true, header,
      vazios: [{ number: 'ABCU7654321', type: '40HC', tareKg: 3900 }],
    }
    state.data = vazios
    render(<MercanteEdiModal voyageId={169} route={{ ...route, kind: 'vazio' }} onClose={vi.fn()} />)

    expect(screen.getByText('1 contêiner vazio')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Baixar arquivo' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
