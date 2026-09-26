// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ToastProvider } from '../../ui/Toast'
import { FileImportModal } from '../FileImportModal'

it('mostra o formato e o encoding detectados junto da prévia do arquivo', async () => {
  const inspectFile = vi.fn().mockResolvedValue({
    format: 'csv',
    encoding: 'utf-8-sig',
    hadBom: true,
    preview: 'BL;Cidade\n1;Vitória',
    byteLength: 21,
  })

  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivo"
        accept=".csv"
        parser={async () => ({ rows: 1 })}
        inspectFile={inspectFile}
        canImport={() => true}
        renderPreview={(preview) => <div>Linhas: {preview.rows}</div>}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  )

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['BL;Cidade\n1;Vitória'], 'dados.csv')] },
  })

  await waitFor(() => expect(inspectFile).toHaveBeenCalled())
  const inspection = screen.getByRole('status')
  expect(inspection.textContent).toContain('Formato detectado: CSV')
  expect(inspection.textContent).toContain('Encoding: UTF-8 com BOM')
  expect(inspection.textContent).toContain('BOM: presente')
  expect(inspection.textContent).toContain('BL;Cidade')
  expect(screen.getByText('Linhas: 1')).toBeTruthy()
})

it('mantem a confirmacao desabilitada quando o contrato rejeita a previa', async () => {
  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivo"
        accept=".csv"
        parser={async () => ({ rows: 1 })}
        canImport={() => false}
        renderPreview={(preview) => <div>Linhas: {preview.rows}</div>}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  )

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['conteudo'], 'dados.csv')] },
  })

  await waitFor(() => expect(screen.getByText('Linhas: 1')).toBeTruthy())
  expect((screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement).disabled).toBe(true)
})

it('mostra todos os erros convertidos em relatorio no preview', async () => {
  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivo"
        accept=".csv"
        parser={async () => ({ rows: 1, rowErrors: [{ row: 2, message: 'primeiro erro', raw: {} }, { row: 99, message: 'ultimo erro', raw: {} }] })}
        getIssues={(preview) => preview.rowErrors.map((error) => ({
          row: error.row,
          field: 'row',
          code: 'invalid_group' as const,
          severity: 'error' as const,
          message: error.message,
        }))}
        canImport={() => false}
        renderPreview={(preview) => <div>Linhas: {preview.rows}</div>}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  )

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['BL;CE\nBL-1;CE-1'], 'dados.csv')] },
  })

  await waitFor(() => expect(screen.getByText('ultimo erro')).toBeTruthy())
  expect(screen.getByText('primeiro erro')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Baixar relatório completo' })).toBeTruthy()
})

it('permite cancelar a leitura de uma seleção em andamento', async () => {
  let release!: () => void
  const parsing = new Promise<void>((resolve) => { release = resolve })
  const parser = vi.fn(async () => {
    await parsing
    return { rows: 1 }
  })

  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivos"
        accept=".csv"
        multiple
        parser={parser}
        canImport={() => true}
        renderPreview={(preview) => <div>Linhas: {preview.rows}</div>}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  )

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['A;B\n1;2'], 'um.csv'), new File(['A;B\n3;4'], 'dois.csv')] },
  })

  await waitFor(() => expect(screen.getByRole('button', { name: 'Interromper leitura' })).toBeTruthy())
  expect(screen.getByRole('progressbar')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Interromper leitura' }))
  release()

  await waitFor(() => expect(screen.queryByText('Linhas: 1')).toBeNull())
  expect(parser).toHaveBeenCalledTimes(1)
})

it('permite override manual quando há pendências/erros na prévia', async () => {
  const importer = vi.fn().mockResolvedValue(undefined)
  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivo"
        accept=".csv"
        parser={async () => ({ rows: 2, rowErrors: [{ row: 2, message: 'erro de porta', raw: {} }] })}
        canImport={(preview, allowOverride) => (preview.rowErrors.length > 0 ? Boolean(allowOverride) : true)}
        importer={importer}
        renderPreview={(preview) => <div>Linhas: {preview.rows}</div>}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  )

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['conteudo'], 'dados.csv')] },
  })

  await waitFor(() => expect(screen.getByText('Linhas: 2')).toBeTruthy())
  const confirmBtn = screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement
  expect(confirmBtn.disabled).toBe(true)

  const checkbox = screen.getByLabelText(/Estou ciente das divergências\/erros/i) as HTMLInputElement
  expect(checkbox.checked).toBe(false)

  fireEvent.click(checkbox)
  expect(checkbox.checked).toBe(true)
  expect(confirmBtn.disabled).toBe(false)

  fireEvent.click(confirmBtn)
  await waitFor(() => expect(importer).toHaveBeenCalledWith(
    expect.objectContaining({ rows: 2 }),
    expect.any(File),
    true,
  ))
})
