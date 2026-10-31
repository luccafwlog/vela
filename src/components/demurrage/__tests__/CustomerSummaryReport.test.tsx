// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CustomerSummaryReport } from '../CustomerSummaryReport'

afterEach(cleanup)

const statement = {
  customer: { id: 1, name: 'Granja Exemplo', cnpj_cpf: '12345678000195' },
  invoices: [{ id: 9, doc_number: 'DEM-2026-0009', bl_id: 'BL-1', billed_at: '2026-10-01T12:00:00Z', total_usd: 2760, current_total_brl: 15069.6, current_roe: 5.46 }],
  boxes: [
    { container_id: 1, bl_id: 'BL-2', container_number: 'MSCU1111111', discharge_date: '2026-09-01', return_date: null, total_days: 59, free_days: 21, usd: 2280, state: 'running', division: 'correndo' },
    { container_id: 2, bl_id: 'BL-2', container_number: 'MSCU2222222', discharge_date: '2026-09-01', return_date: '2026-10-10', total_days: 40, free_days: 21, usd: 1140, state: 'returned_overstay', division: 'a_emitir' },
  ],
} as never

// D12 da ADR 0112: o extrato de um Cliente traz as Invoices em aberto e as
// caixas ainda sem Invoice; mantém o cabeçalho do lote 6b (logo escura,
// CNPJ mascarado, US$ em pt-BR e Emitido em no canto).
it('extrato do Cliente: Invoices em aberto, caixas sem Invoice e a nota do valor previsto', () => {
  const { container } = render(<CustomerSummaryReport statement={statement} />)
  expect(screen.getByText('EXTRATO DE DEMURRAGE')).toBeTruthy()
  expect(screen.getByText(/12\.345\.678\/0001-95/)).toBeTruthy()
  expect(screen.getByText('DEM-2026-0009')).toBeTruthy()
  expect(screen.getAllByText('US$ 2.760,00')).toHaveLength(2)
  expect(screen.getByText('MSCU1111111')).toBeTruthy()
  expect(screen.getByText('Fora')).toBeTruthy()
  expect(screen.getByText('Correndo')).toBeTruthy()
  expect(screen.getByText('A emitir')).toBeTruthy()
  expect(screen.getByText('US$ 3.420,00')).toBeTruthy()
  expect(screen.getByText(/muda até a devolução do container e a emissão da Invoice/)).toBeTruthy()
  const today = new Date().toLocaleDateString('pt-BR')
  expect(screen.getByText(`Emitido em ${today}`)).toBeTruthy()
  expect(container.textContent?.match(/Emitido em/g)).toHaveLength(1)
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/branding/transhipping-logo-cropped.png')
})

it('Cliente sem Invoice em aberto nem caixa sem Invoice diz isso', () => {
  render(<CustomerSummaryReport statement={{ customer: { id: 1, name: 'X', cnpj_cpf: null }, invoices: [], boxes: [] }} />)
  expect(screen.getByText('Nenhuma Invoice de Demurrage em aberto.')).toBeTruthy()
  expect(screen.getByText('Nenhum container com Demurrage sem Invoice.')).toBeTruthy()
})
