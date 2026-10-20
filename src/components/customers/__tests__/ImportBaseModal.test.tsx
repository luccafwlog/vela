// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ImportBaseModal } from '../ImportBaseModal'
import type { CustomerBaseRow, ParsedCustomerBase } from '../../../services/customerBase'

afterEach(cleanup)

const row = (overrides: Partial<CustomerBaseRow> = {}): CustomerBaseRow => ({
  cnpj_cpf: '12345678000195',
  name: 'ACME',
  trade_name: null,
  emails: ['a@acme.test'],
  address: null,
  city: null,
  state: null,
  zip: null,
  row_number: 2,
  ...overrides,
})

function renderModal(parsedBase: ParsedCustomerBase | null, extra: Partial<Parameters<typeof ImportBaseModal>[0]> = {}) {
  const props = {
    open: true,
    baseFile: new File(['x'], 'base.xlsx'),
    parsedBase,
    parsingBase: false,
    importingBase: false,
    onClose: vi.fn(),
    onFileSelect: vi.fn(),
    onImport: vi.fn(),
    ...extra,
  }
  render(<ImportBaseModal {...props} />)
  return props
}

it('recusa do banco: nada gravado, o Resultado lista o Cliente recusado e só oferece Concluir', async () => {
  const props = renderModal({ rows: [row()], rowErrors: [] }, {
    refused: [{ cnpj_cpf: '12345678000195', message: 'E-mail inválido.' }],
  })

  const alert = screen.getByText('Nada foi gravado: a base foi recusada').closest('[role="alert"]') as HTMLElement
  expect(alert.textContent).toMatch(/12\.345\.678\/0001-95: E-mail inválido\./)
  expect(screen.getByText('Nada foi gravado. Corrija a planilha e escolha o arquivo de novo.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Importar/ })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
  expect(props.onClose).toHaveBeenCalledTimes(1)
  expect(props.onImport).not.toHaveBeenCalled()
})

it('qualquer linha inválida bloqueia a base inteira na prévia', async () => {
  const props = renderModal({
    rows: [row()],
    rowErrors: [{ row: 3, message: 'Linha sem e-mail válido.', raw: {} }],
  })

  expect(screen.getByText('Linha sem e-mail válido.')).toBeTruthy()
  const button = screen.getByRole('button', { name: 'Importar 1 Cliente' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  await userEvent.click(button)
  expect(props.onImport).not.toHaveBeenCalled()
  expect(screen.getByText(/Com erro no arquivo, nada é importado/)).toBeTruthy()
})

it('troca de razão social é aviso: pede o aceite, e o aceite segue para a gravação', async () => {
  const props = renderModal({
    rows: [row({ existingCustomerId: 7, currentName: 'ACME ANTIGA', changedFields: ['Razão Social'] })],
    rowErrors: [],
  })

  expect(screen.getByText(/razão social muda de "ACME ANTIGA" para "ACME"/)).toBeTruthy()
  expect(screen.getByText('Atualiza a razão social')).toBeTruthy()
  const button = screen.getByRole('button', { name: 'Importar 1 Cliente' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  await userEvent.click(screen.getByRole('checkbox', { name: /Conferi os avisos/ }))
  await userEvent.click(button)
  expect(props.onImport).toHaveBeenCalledWith(true)
})

it('falha ao gravar fica no modal, com a prévia e o botão para tentar de novo', () => {
  renderModal({ rows: [row()], rowErrors: [] }, { writeError: 'Sem conexão com o servidor.' })

  const alert = screen.getByText('Não foi possível gravar a base').closest('[role="alert"]') as HTMLElement
  expect(alert.textContent).toContain('Nada foi gravado: Sem conexão com o servidor.')
  expect((screen.getByRole('button', { name: 'Importar 1 Cliente' }) as HTMLButtonElement).disabled).toBe(false)
})
