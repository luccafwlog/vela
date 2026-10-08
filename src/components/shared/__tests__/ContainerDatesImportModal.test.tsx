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
  parseContainerDatesFile: mocks.parse,
  importContainerDates: mocks.importDates,
}))

import { ContainerDatesImportModal } from '../ContainerDatesImportModal'

afterEach(cleanup)

it('mostra o resultado parcial e não oferece reenviar o mesmo lote', async () => {
  mocks.parse.mockResolvedValue({
    rows: [
      { bl_id: 'BL1', container_number: 'MSCU1234567', discharge_date: '2026-03-02', return_date: null },
      { bl_id: 'BL2', container_number: 'MSCU7654321', discharge_date: '2026-03-03', return_date: '2026-03-20' },
    ],
    rowErrors: [],
  })
  mocks.importDates.mockResolvedValue({
    updated: 1,
    missing: 0,
    errors: [{ bl_id: 'BL2', container_number: 'MSCU7654321', message: 'Devolução anterior à descarga.' }],
  })
  const onClose = vi.fn()
  const { container } = render(<ContainerDatesImportModal open onClose={onClose} />)

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'datas.csv')] },
  })
  // Datas em dd/mm/aaaa na prévia.
  expect(await screen.findByText('02/03/2026')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Importar 2 linhas' }))

  await waitFor(() => expect(screen.getByText('Devolução anterior à descarga.')).toBeTruthy())
  expect(mocks.importDates).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: /^Importar/ })).toBeNull()
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
  expect(onClose).toHaveBeenCalled()
})
