// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImportFilePicker } from '../ImportParts'
import { ImportReadProgress } from '../ImportReadProgress'
import { ImportIssuesPanel } from '../ImportIssuesPanel'

afterEach(cleanup)

it('aceita arquivo arrastado e só o primeiro quando não é múltiplo', () => {
  const onFiles = vi.fn()
  const { container } = render(<ImportFilePicker accept=".csv" files={[]} onFiles={onFiles} />)
  const a = new File(['a'], 'a.csv')
  const b = new File(['b'], 'b.csv')

  fireEvent.drop(container.querySelector('.app-import-drop') as HTMLElement, { dataTransfer: { files: [a, b] } })

  expect(onFiles).toHaveBeenCalledWith([a])
})

it('ignora arraste quando desativado e diz por quê', () => {
  const onFiles = vi.fn()
  const { container } = render(
    <ImportFilePicker accept=".csv" files={[]} onFiles={onFiles} disabled disabledReason="Escolha a viagem antes." />,
  )

  fireEvent.drop(container.querySelector('.app-import-drop') as HTMLElement, { dataTransfer: { files: [new File(['a'], 'a.csv')] } })

  expect(onFiles).not.toHaveBeenCalled()
  const input = screen.getByLabelText('Arquivo (CSV)') as HTMLInputElement
  expect(input.disabled).toBe(true)
  const reasonId = input.getAttribute('aria-describedby')?.split(' ').find((id) => id.endsWith('-reason'))
  expect(document.getElementById(reasonId ?? '')?.textContent).toBe('Escolha a viagem antes.')
})

it('limpa o valor do input para reler o mesmo arquivo depois de corrigido', () => {
  const onFiles = vi.fn()
  render(<ImportFilePicker accept=".csv" files={[]} onFiles={onFiles} />)
  const input = screen.getByLabelText('Arquivo (CSV)') as HTMLInputElement
  const file = new File(['a'], 'a.csv')

  fireEvent.change(input, { target: { files: [file] } })

  expect(onFiles).toHaveBeenCalledWith([file])
  expect(input.value).toBe('')
})

it('mostra o arquivo escolhido com tamanho, no lugar do convite', () => {
  render(<ImportFilePicker accept=".xlsx" files={[new File(['x'.repeat(2048)], 'manifesto.xlsx')]} onFiles={vi.fn()} />)
  expect(screen.getByText('manifesto.xlsx')).toBeTruthy()
  expect(screen.getByText('2 KB')).toBeTruthy()
  expect(screen.queryByText('Escolher arquivo')).toBeNull()
})

it('não inventa porcentagem ao ler um único arquivo', () => {
  render(<ImportReadProgress progress={{ completed: 0, total: 1, currentFile: 'a.csv' }} />)
  const bar = screen.getByRole('progressbar')
  expect(bar.getAttribute('aria-valuenow')).toBeNull()
  expect(screen.getByText(/Nada é gravado nesta fase/)).toBeTruthy()
})

it('conta arquivos lidos quando há vários', () => {
  render(<ImportReadProgress progress={{ completed: 1, total: 3, currentFile: 'b.csv' }} />)
  const bar = screen.getByRole('progressbar')
  expect(bar.getAttribute('aria-valuenow')).toBe('1')
  expect(bar.getAttribute('aria-valuetext')).toBe('1 de 3 arquivos lidos')
  expect(screen.getByText(/Lendo arquivo 2 de 3/)).toBeTruthy()
})

it('trata avisos sem bloquear e marca a severidade em texto', () => {
  render(
    <ImportIssuesPanel
      issues={[{ row: 4, field: 'value', code: 'ambiguous_number', severity: 'warning', message: '259.312 pode ser 259 mil' }]}
    />,
  )
  expect(screen.getByRole('status')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText('1 aviso para conferir')).toBeTruthy()
  expect(screen.getByText('Aviso')).toBeTruthy()
  expect(screen.getByText('Linha 4 · valor')).toBeTruthy()
})
