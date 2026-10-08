// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ImportBaseModal } from '../ImportBaseModal'

afterEach(cleanup)

it('resultado parcial da base fica no modal, com o que entrou, os pendentes e só Concluir', async () => {
  const onClose = vi.fn()
  const onImport = vi.fn()
  render(
    <ImportBaseModal
      open
      baseFile={new File(['x'], 'base.xlsx')}
      parsedBase={{ rows: [], rowErrors: [] } as never}
      parsingBase={false}
      importingBase={false}
      outcome={{
        imported: 3,
        updated: 1,
        contactsCreated: 2,
        blsLinked: 0,
        errors: [{ cnpj_cpf: '12345678000195', message: 'Razão Social vazia' }],
      }}
      onClose={onClose}
      onFileSelect={vi.fn()}
      onImport={onImport}
    />,
  )

  const notice = screen.getByText(/1 cliente ficou pendente/).closest('[role="status"]') as HTMLElement
  expect(notice).toBeTruthy()
  expect(notice.textContent).toMatch(/3 novos, 1 atualizado, 2 contatos/)
  expect(notice.textContent).toMatch(/12\.345\.678\/0001-95: Razão Social vazia/)
  expect(screen.getByText('Base gravada em parte. Os clientes pendentes estão acima.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Importar base' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(onImport).not.toHaveBeenCalled()
})
