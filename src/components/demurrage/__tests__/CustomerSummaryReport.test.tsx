// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CustomerSummaryReport } from '../CustomerSummaryReport'

afterEach(cleanup)

// Lote 6b: CNPJ com máscara, dólar "US$", logo visível no papel e a data de
// emissão no canto do número (sem repetir no subtítulo).
it('resumo por consignatário: CNPJ mascarado, US$ em pt-BR e Emitido em no canto', () => {
  const { container } = render(<CustomerSummaryReport rows={[
    { customer_id: 1, customer_name: 'Granja Exemplo', cnpj_cpf: '12345678000195', invoice_count: 2, total_usd: 2760, total_brl: 15069.6 },
  ] as never} />)
  expect(screen.getByText('12.345.678/0001-95')).toBeTruthy()
  expect(screen.getAllByText('US$ 2.760,00')).toHaveLength(2)
  const today = new Date().toLocaleDateString('pt-BR')
  expect(screen.getByText(`Emitido em ${today}`)).toBeTruthy()
  expect(screen.queryByText(/DEMURRAGE EM ABERTO$/)).toBeNull()
  expect(container.textContent?.match(/Emitido em/g)).toHaveLength(1)
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/branding/transhipping-logo-cropped.png')
})
