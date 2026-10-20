// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  importDates: vi.fn(),
  after: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../services/cacheEffects', () => ({ afterDatasContainerAlteradas: mocks.after }))
vi.mock('../../../services/containerDatesImport', () => ({
  readContainerDatesFile: mocks.parse,
  importContainerDates: mocks.importDates,
}))

import { ContainerDatesImportModal } from '../ContainerDatesImportModal'

afterEach(cleanup)

const twoRows = {
  rows: [
    { bl_id: 'BL1', container_number: 'MSCU1234567', discharge_date: '2026-03-02', return_date: null },
    { bl_id: 'BL2', container_number: 'MSCU7654321', discharge_date: '2026-03-03', return_date: '2026-03-20' },
  ],
  rowErrors: [],
}

function chooseFile(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'datas.csv')] },
  })
}

it('recusa do banco: nada é gravado, o Resultado lista o B/L recusado e não oferece reenviar', async () => {
  mocks.parse.mockResolvedValue(twoRows)
  mocks.importDates.mockResolvedValue({
    ok: false,
    updated: 0,
    unchanged: 0,
    errors: [{ bl_id: 'BL2', container_number: '', message: 'Devolução anterior à descarga.' }],
  })
  const onClose = vi.fn()
  const { container } = render(<ContainerDatesImportModal open onClose={onClose} />)

  chooseFile(container)
  // Datas em dd/mm/aaaa na prévia.
  expect(await screen.findByText('02/03/2026')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Importar 2 containers' }))

  await waitFor(() => expect(screen.getByText('Devolução anterior à descarga.')).toBeTruthy())
  expect(screen.getByText('Nada foi gravado: o arquivo foi recusado')).toBeTruthy()
  expect(mocks.importDates).toHaveBeenCalledTimes(1)
  // Nada gravado: nenhuma tela é invalidada e não há toast de sucesso.
  expect(mocks.after).not.toHaveBeenCalled()
  expect(mocks.showToast).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /^Importar/ })).toBeNull()
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
  expect(onClose).toHaveBeenCalled()
})

it('qualquer linha com erro bloqueia a importação do arquivo inteiro', async () => {
  mocks.importDates.mockReset()
  mocks.parse.mockResolvedValue({
    ...twoRows,
    rowErrors: [{ row: 4, message: 'Data de descarga inválida ou ausente.', raw: {} }],
  })
  const { container } = render(<ContainerDatesImportModal open onClose={vi.fn()} />)

  chooseFile(container)
  expect(await screen.findByText('Data de descarga inválida ou ausente.')).toBeTruthy()
  const button = screen.getByRole('button', { name: 'Importar 2 containers' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.click(button)
  expect(mocks.importDates).not.toHaveBeenCalled()
  expect(screen.getByText(/Com erro no arquivo, nada é importado/)).toBeTruthy()
})

it('sem recusa, grava o arquivo inteiro e fecha', async () => {
  mocks.parse.mockResolvedValue(twoRows)
  mocks.importDates.mockResolvedValue({ ok: true, updated: 2, unchanged: 0, errors: [] })
  const onClose = vi.fn()
  const { container } = render(<ContainerDatesImportModal open onClose={onClose} />)

  chooseFile(container)
  fireEvent.click(await screen.findByRole('button', { name: 'Importar 2 containers' }))

  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(mocks.after).toHaveBeenCalled()
  expect(mocks.showToast).toHaveBeenCalledWith('2 containers atualizados.', 'success')
})
