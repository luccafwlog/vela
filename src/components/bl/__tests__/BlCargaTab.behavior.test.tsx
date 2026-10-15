// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { BlCargaTab } from '../BlCargaTab'
import type { BLDetail } from '../../../types/database'

vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

const container = { id: 9, container_number: 'CSNU6012309', type: '20GP', ownership: null, seal_number: 'SL88109', gross_weight_kg: 47900, cbm: 24, discharge_date: '2026-10-13', return_date: null, is_imo: false, is_oog: false }

function renderTab(bl: Partial<BLDetail>, props: { cargoMode?: 'container' | 'carga_solta' | 'misto'; chargesLocked?: boolean } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <BlCargaTab active bl={{ id: 'BL-1', voyage_id: 10, ...bl } as BLDetail} cargoMode={props.cargoMode ?? 'container'} canCorrect chargesLocked={props.chargesLocked ?? false} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('aba Carga do B/L', () => {
  it('B/L de contêiner sem veículo mostra só Contêineres', () => {
    renderTab({ bl_containers: [container] as never, vehicles: [] })
    expect(screen.getByRole('heading', { name: 'Contêineres' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Veículos' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Carga solta' })).toBeNull()
  })

  it('B/L só de carga solta não mostra Contêineres nem Veículos', () => {
    renderTab({ bl_containers: [], vehicles: [] }, { cargoMode: 'carga_solta' })
    expect(screen.getByRole('heading', { name: 'Carga solta' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Contêineres' })).toBeNull()
    expect(screen.getByText(/Nenhum dado de carga solta informado/)).toBeTruthy()
  })

  it('Corrigir abre a janela com os dados do container; B/L faturado trava Perfil e COC/SOC, não lacre, peso, CBM e datas', () => {
    renderTab({ bl_containers: [container] as never, vehicles: [] }, { chargesLocked: true })
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir container CSNU6012309' }))
    const dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText('Perfil') as HTMLSelectElement).disabled).toBe(true)
    expect((within(dialog).getByLabelText('COC/SOC') as HTMLSelectElement).disabled).toBe(true)
    expect((within(dialog).getByLabelText('Lacre') as HTMLInputElement).value).toBe('SL88109')
    expect((within(dialog).getByLabelText('Lacre') as HTMLInputElement).disabled).toBe(false)
    expect((within(dialog).getByLabelText('Peso bruto (kg)') as HTMLInputElement).value).toBe('47900')
    expect((within(dialog).getByLabelText('Descarga') as HTMLInputElement).value).toBe('2026-10-13')
  })
})
