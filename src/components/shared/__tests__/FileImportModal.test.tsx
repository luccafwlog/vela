// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ToastProvider } from '../../ui/Toast'
import { FileImportModal } from '../FileImportModal'

// Lote 6a: o diagnóstico técnico (formato, encoding, BOM) saiu da tela; o
// modal mostra a linha de passos e o bloco Arquivo do molde.
it('não mostra diagnóstico técnico; mostra os passos e o bloco Arquivo', async () => {
  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivo"
        accept=".csv"
        parser={async () => ({ rows: 1 })}
        canImport={() => true}
        renderPreview={(preview) => <div>Linhas: {preview.rows}</div>}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  )
  expect(screen.getByRole('heading', { name: 'Arquivo' })).toBeTruthy()
  expect(screen.getByRole('list', { name: 'Passos da importação' }).querySelector('[aria-current="step"]')?.textContent).toBe('Arquivo')

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['BL;Cidade\n1;Vitória'], 'dados.csv')] },
  })

  expect(await screen.findByText('Linhas: 1')).toBeTruthy()
  expect(screen.getByRole('list', { name: 'Passos da importação' }).querySelector('[aria-current="step"]')?.textContent).toBe('Prévia')
  expect(container.textContent).not.toMatch(/Encoding|BOM|Formato detectado/)
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

// Regra de 2026-10-19 (ADR 0091): erro recusa a importação inteira, sem
// "forçar"; o aceite vale só para avisos.
it('com erro não oferece forçar a importação e mantém o botão desligado', async () => {
  const importer = vi.fn().mockResolvedValue(undefined)
  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivo"
        accept=".csv"
        parser={async () => ({ rows: 2, rowErrors: [{ row: 2, message: 'erro de porta', raw: {} }] })}
        canImport={(preview, allowOverride) => (preview.rowErrors.length > 0 ? Boolean(allowOverride) : true)}
        getIssues={() => [{ row: 2, field: 'pod', code: 'unknown_port', severity: 'error', message: 'erro de porta' }]}
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
  expect((screen.getByRole('button', { name: 'Importar' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.getByText(/Com erro no arquivo, nada é importado/)).toBeTruthy()
  expect(importer).not.toHaveBeenCalled()
})

it('com aviso pede o aceite e então importa o arquivo inteiro', async () => {
  const importer = vi.fn().mockResolvedValue(undefined)
  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivo"
        accept=".csv"
        parser={async () => ({ rows: 2 })}
        canImport={(_preview, allowOverride) => Boolean(allowOverride)}
        getIssues={() => [{ row: 2, field: 'pod', code: 'unknown_port', severity: 'warning', message: 'confira o porto' }]}
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
  fireEvent.click(screen.getByLabelText(/Conferi os avisos e quero importar o arquivo/i))
  expect(confirmBtn.disabled).toBe(false)
  fireEvent.click(confirmBtn)
  await waitFor(() => expect(importer).toHaveBeenCalledWith(expect.objectContaining({ rows: 2 }), expect.any(File), true))
})

it('com vários arquivos, um arquivo recusado bloqueia todos', async () => {
  const importer = vi.fn().mockResolvedValue(undefined)
  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivos"
        accept=".csv"
        multiple
        parser={async (file: File) => ({ ok: file.name !== 'ruim.csv' })}
        canImport={(preview) => preview.ok}
        importer={importer}
        renderPreview={(preview) => <div>{preview.ok ? 'ok' : 'com erro'}</div>}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  )

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['a'], 'bom.csv'), new File(['b'], 'ruim.csv')] },
  })

  expect(await screen.findByText(/Com erro no arquivo, nada é importado/)).toBeTruthy()
  const confirmBtn = screen.getAllByRole('button').find((button) => button.textContent?.startsWith('Importar')) as HTMLButtonElement
  expect(confirmBtn.disabled).toBe(true)
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
  expect(screen.queryByText('Não foi possível ler o arquivo')).toBeNull()
})

// Fechar no meio da gravação desmontava o modal com a gravação seguindo sem
// tela: X, Escape e Voltar não fecham enquanto grava.
it('não fecha durante a gravação; fecha depois', async () => {
  const onClose = vi.fn()
  let finish: (() => void) | undefined
  const importer = vi.fn(() => new Promise<undefined>((resolve) => { finish = () => resolve(undefined) }))
  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivo"
        accept=".csv"
        parser={async () => ({ rows: 1 })}
        canImport={() => true}
        importer={importer}
        renderPreview={(preview) => <div>Linhas: {preview.rows}</div>}
        onClose={onClose}
      />
    </ToastProvider>,
  )
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'ok.csv')] },
  })
  await screen.findByText('Linhas: 1')
  fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
  await waitFor(() => expect(importer).toHaveBeenCalledTimes(1))
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Fechar modal' }))
  expect(onClose).not.toHaveBeenCalled()
  finish?.()
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})

// Só avisos e nada a gravar (manifesto BB só com B/Ls cancelados): não é
// "Com erro no arquivo"; o rodapé diz que não há o que importar.
it('nothingToImport: sem erro e nada a gravar desativa Importar com a frase própria', async () => {
  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivo"
        accept=".csv"
        parser={async () => ({ rows: 0 })}
        canImport={() => true}
        getIssues={() => [{ row: 3, field: 'bl', code: 'invalid_group', severity: 'warning', message: 'B/L X cancelado: a linha não é tocada.' }] as never}
        nothingToImport={(entries) => entries.every((entry) => entry.preview.rows === 0) ? 'Nenhum B/L a importar.' : null}
        renderPreview={(preview) => <div>Linhas: {preview.rows}</div>}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  )
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'ok.csv')] },
  })
  await screen.findByText('Linhas: 0')
  expect(screen.getByText('Nenhum B/L a importar.')).toBeTruthy()
  expect(screen.queryByText(/Com erro no arquivo/)).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect((screen.getByRole('button', { name: 'Importar' }) as HTMLButtonElement).disabled).toBe(true)
})

// Depois do resultado, trocar a opção de leitura não relê o arquivo nem
// reabre o Importar; o pré-requisito recebe `locked` para travar os campos.
it('depois do resultado, reparseKey novo não apaga o resultado e o pré-requisito fica travado', async () => {
  const parser = vi.fn(async () => ({ rows: 1 }))
  const importer = vi.fn(async () => 'gravado')
  const view = (key: string) => (
    <ToastProvider>
      <FileImportModal<{ rows: number }, string>
        title="Importar arquivo"
        accept=".csv"
        parser={parser}
        reparseKey={key}
        canImport={() => true}
        importer={importer}
        prerequisite={({ locked }) => <input aria-label="Viagem" disabled={locked} readOnly />}
        renderPreview={(preview) => <div>Linhas: {preview.rows}</div>}
        renderImportResult={(result) => <div>Resultado: {result}</div>}
        onClose={vi.fn()}
      />
    </ToastProvider>
  )
  const { container, rerender } = render(view('a'))
  expect((screen.getByLabelText('Viagem') as HTMLInputElement).disabled).toBe(false)
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'ok.csv')] },
  })
  await screen.findByText('Linhas: 1')
  fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
  expect(await screen.findByText('Resultado: gravado')).toBeTruthy()
  expect((screen.getByLabelText('Viagem') as HTMLInputElement).disabled).toBe(true)

  rerender(view('b'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(parser).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Resultado: gravado')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Concluir' })).toBeTruthy()
  expect(importer).toHaveBeenCalledTimes(1)
})
