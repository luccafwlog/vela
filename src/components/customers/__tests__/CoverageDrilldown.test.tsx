// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { CoverageCellText } from '../CoverageDrilldown'

const now = new Date('2026-10-20T12:00:00Z')
const cell = (sentStatus: string) => ({ state: 'enviado' as const, sentAt: '2026-10-20T13:00:00Z', sentStatus, communicationId: 7, reason: null })

// D02 de 2026-10-27: a célula diz se o Comunicado foi enviado, redirecionado ao suporte ou parcial.
describe('CoverageCellText', () => {
  it.each([
    ['enviado', /^Enviado em/],
    ['simulado', /^Redirecionado ao suporte em/],
    ['parcial', /^Parcial em/],
  ])('situação %s', (status, label) => {
    render(<MemoryRouter><CoverageCellText cell={cell(status)} kind="aviso_chegada_noa" now={now} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe('/clientes/comunicacao?tab=historico&communication=7')
  })
})
