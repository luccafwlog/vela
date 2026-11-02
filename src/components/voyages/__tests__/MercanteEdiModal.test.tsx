// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MercanteCargoInput, MercanteVaziosInput } from '../../../services/mercanteEdiData'

const state = vi.hoisted(() => ({ data: undefined as unknown }))

vi.mock('../../../hooks/useManifestosMercante', () => ({
  useMercanteEdiInput: () => ({ data: state.data, isLoading: false, error: null }),
}))

import { MercanteEdiModal } from '../MercanteEdiModal'

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
  it('rota completa: mostra o resumo e baixa o arquivo com o nome do navio e da viagem', () => {
    state.data = cargo()
    const createObjectURL = vi.fn(() => 'blob:edi')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<MercanteEdiModal voyageId={169} route={route} onClose={vi.fn()} />)

    expect(screen.getByText('CNTAG → BRVIX')).toBeTruthy()
    expect(screen.getByText(/Pronto para baixar/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const link = click.mock.contexts[0] as HTMLAnchorElement
    expect(link.download).toMatch(/^FWL_MERCANTE_\d{12}_GG6\.TXT$/)
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
