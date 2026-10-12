// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { inspectImportUpload } from '../../../services/importText'
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
  expect((screen.getByRole('button', { name: 'Importar' }) as HTMLButtonElement).disabled).toBe(true)
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
  const confirmBtn = screen.getByRole('button', { name: 'Importar' }) as HTMLButtonElement
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

it('mostra a falha de leitura na tela, junto do arquivo', async () => {
  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivo"
        accept=".csv"
        parser={async () => { throw new Error('Cabeçalho BL não encontrado.') }}
        canImport={() => true}
        renderPreview={() => null}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  )

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'ruim.csv')] },
  })

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Não foi possível ler o arquivo')
  expect(alert.textContent).toContain('ruim.csv')
  expect(alert.textContent).toContain('Cabeçalho BL não encontrado.')
  expect((screen.getByRole('button', { name: 'Importar' }) as HTMLButtonElement).disabled).toBe(true)
})

it('mantém a prévia aberta e explica quando a gravação falha', async () => {
  const onClose = vi.fn()
  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivo"
        accept=".csv"
        confirmLabel="Importar manifesto"
        parser={async () => ({ rows: 1 })}
        canImport={() => true}
        importer={async () => { throw new Error('Viagem não encontrada.') }}
        renderPreview={(preview) => <div>Linhas: {preview.rows}</div>}
        onClose={onClose}
      />
    </ToastProvider>,
  )

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'ok.csv')] },
  })
  await waitFor(() => expect(screen.getByText('Linhas: 1')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Importar manifesto' }))

  await waitFor(() => expect(screen.getByText('A importação não foi concluída')).toBeTruthy())
  expect(screen.getByText('Viagem não encontrada.')).toBeTruthy()
  expect(screen.getByText('Linhas: 1')).toBeTruthy()
  expect(onClose).not.toHaveBeenCalled()
})

// ADR 0078, item 22: CSV Windows-1252 é aceito com aviso. O diagnóstico roda
// antes do parser; recusar ali barrava o Manifesto BB, os Vazios de Importação
// e Chegadas/Saídas com "Bytes inválidos em UTF-8".
it('lê o CSV Windows-1252 pelo diagnóstico comum, sem falha de leitura', async () => {
  const parser = vi.fn(async () => ({ rows: 1 }))
  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivo"
        accept=".csv"
        parser={parser}
        inspectFile={inspectImportUpload}
        canImport={() => true}
        renderPreview={(preview) => <div>Linhas: {preview.rows}</div>}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  )

  // "BL;Cidade\n1;São" em Windows-1252.
  const bytes = Uint8Array.from([0x42, 0x4c, 0x3b, 0x43, 0x69, 0x64, 0x61, 0x64, 0x65, 0x0a, 0x31, 0x3b, 0x53, 0xe3, 0x6f])
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File([bytes], 'ansi.csv')] },
  })

  expect(await screen.findByText('Linhas: 1')).toBeTruthy()
  expect(parser).toHaveBeenCalled()
  expect(screen.getByLabelText('Diagnóstico do arquivo').textContent).toContain('Encoding: Windows-1252')
  expect(screen.queryByText('Não foi possível ler o arquivo')).toBeNull()
})

// Revisão da PR 929: Vazios de Importação pergunta antes de gravar uma
// planilha com ocultas. Voltar não grava, não mostra falha e mantém a prévia.
it('confirmBeforeImport: voltar não grava e mantém a prévia; confirmar grava', async () => {
  const onClose = vi.fn()
  const importer = vi.fn(async () => undefined)
  const confirmBeforeImport = vi.fn<(preview: { rows: number }) => Promise<boolean>>()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true)
  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivo"
        accept=".csv"
        confirmLabel="Importar manifesto"
        parser={async () => ({ rows: 1 })}
        canImport={() => true}
        confirmBeforeImport={confirmBeforeImport}
        importer={importer}
        renderPreview={(preview) => <div>Linhas: {preview.rows}</div>}
        onClose={onClose}
      />
    </ToastProvider>,
  )

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'ok.csv')] },
  })
  await waitFor(() => expect(screen.getByText('Linhas: 1')).toBeTruthy())

  fireEvent.click(screen.getByRole('button', { name: 'Importar manifesto' }))
  await waitFor(() => expect(confirmBeforeImport).toHaveBeenCalledTimes(1))
  expect(confirmBeforeImport).toHaveBeenCalledWith({ rows: 1 }, expect.any(File))
  expect(importer).not.toHaveBeenCalled()
  expect(screen.queryByText('A importação não foi concluída')).toBeNull()
  expect(screen.getByText('Linhas: 1')).toBeTruthy()
  expect(onClose).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Importar manifesto' }))
  await waitFor(() => expect(importer).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
})
