// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlTransshipmentCard } from '../BlTransshipmentCard'

afterEach(cleanup)

const omission = { id: 9, voyageId: 7, omittedPod: 'VITORIA', dischargePod: 'SANTOS', reason: null, onwardVesselName: 'MSC X', onwardCarrier: 'MSC', onwardVoyageNumber: '123A', onwardEtd: '2026-07-10', onwardEta: '2026-07-14' }

describe('BlTransshipmentCard', () => {
  it('exibe dados herdados e acao COD', () => {
    render(<MemoryRouter><BlTransshipmentCard omission={omission} disposition="transshipment" saving={false} onCod={vi.fn()} onRestore={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText(/SANTOS/)).toBeTruthy()
    expect(screen.getByText('MSC X')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Marcar COD/ })).toBeTruthy()
  })
  it('exige confirmacao e justificativa antes de marcar COD', () => {
    const onCod = vi.fn()
    render(<MemoryRouter><BlTransshipmentCard omission={omission} disposition="transshipment" saving={false} onCod={onCod} /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /Marcar COD/ }))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/Justificativa/))
    expect(screen.getByText(/altera o destino final/i)).toBeTruthy()
    expect(screen.getByText(/notifica o cliente quando houver cliente vinculado/i)).toBeTruthy()

    const confirm = screen.getByRole('button', { name: /Confirmar COD/ }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Justificativa/), { target: { value: 'Cliente solicitou o novo destino' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)

    expect(onCod).toHaveBeenCalledWith('Cliente solicitou o novo destino')
  })
  it('exibe reversao quando disposicao e COD', () => {
    render(<MemoryRouter><BlTransshipmentCard omission={omission} disposition="cod" saving={false} onCod={vi.fn()} onRestore={vi.fn()} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'COD para SANTOS' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reverter para transbordo/ })).toBeTruthy()
  })
  it('exige confirmacao e justificativa para reverter COD', () => {
    const onRestore = vi.fn()
    render(<MemoryRouter><BlTransshipmentCard omission={omission} disposition="cod" saving={false} onRestore={onRestore} /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /Reverter para transbordo/ }))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/Justificativa/))
    expect(screen.getByText(/restaura o destino original/i)).toBeTruthy()
    expect(screen.getByText(/notifica o cliente sobre a correção quando houver cliente vinculado/i)).toBeTruthy()

    const confirm = screen.getByRole('button', { name: /Confirmar reversão/ }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(onRestore).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/Justificativa/), { target: { value: '  Cliente confirmou a restauração do destino  ' } })
    expect(confirm.disabled).toBe(false)
    expect(onRestore).not.toHaveBeenCalled()

    fireEvent.click(confirm)

    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onRestore).toHaveBeenCalledWith('Cliente confirmou a restauração do destino')
  })
  it('sem permissao (onCod ausente), mostra o estado mas nenhum botao de acao', () => {
    render(<MemoryRouter><BlTransshipmentCard omission={omission} disposition="transshipment" saving={false} /></MemoryRouter>)
    expect(screen.getByText(/SANTOS/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Marcar COD/ })).toBeNull()
  })
  it('sem permissao (onRestore ausente), mostra o estado mas nenhum botao de acao', () => {
    render(<MemoryRouter><BlTransshipmentCard omission={omission} disposition="cod" saving={false} /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: /Reverter para transbordo/ })).toBeNull()
  })
})
