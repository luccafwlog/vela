// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopyValue } from '../CopyValue'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CopyValue', () => {
  it('copia o identificador e avisa ao leitor de tela', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<CopyValue value="COSU6401234501" label="número do B/L" />)

    expect(screen.getByText('COSU6401234501')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copiar número do B/L COSU6401234501' }))
    })

    expect(writeText).toHaveBeenCalledWith('COSU6401234501')
    expect(screen.getByText('número do B/L copiado')).toBeTruthy()
  })

  it('o clique no ícone não aciona o link ou a linha em volta', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    const onRowClick = vi.fn()
    render(
      <div onClick={onRowClick}>
        <CopyValue value="152605123456701" label="CE Mercante" />
      </div>,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copiar CE Mercante/ }))
    })
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('sem área de transferência, avisa a falha', async () => {
    vi.stubGlobal('navigator', {})
    render(<CopyValue value="12.345.678/0001-90" label="CNPJ" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copiar CNPJ/ }))
    })
    expect(screen.getByText('Não foi possível copiar o CNPJ')).toBeTruthy()
  })

  it('sem valor, não oferece cópia', () => {
    render(<CopyValue value={null} label="CE Mercante">—</CopyValue>)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('—')).toBeTruthy()
  })
})
