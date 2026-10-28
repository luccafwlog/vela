// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BlPortalCard } from '../BlPortalCard'

describe('BlPortalCard', () => {
  it('mostra motivos quando invisivel', () => {
    render(<BlPortalCard status={{ visibility: { visible: false, reasons: ['Sem CE Mercante'], billingReady: false, accountSituation: 'ativo' }, notifications: [], openDisputes: [] }} />)
    expect(screen.getByText(/Não visível no Portal/)).toBeTruthy()
    expect(screen.getByText('Sem CE Mercante')).toBeTruthy()
    expect(screen.getByText(/Não: a fatura fica retida/)).toBeTruthy()
  })
  it('mostra visivel, notificacoes e disputas abertas', () => {
    render(<BlPortalCard status={{ visibility: { visible: true, reasons: [], billingReady: true, accountSituation: 'ativo' }, notifications: [{ id: 1, type: 'transshipment', title: 'Escala omitida', created_at: '2026-07-10T00:00:00Z', read_at: null }], openDisputes: [{ id: 5, doc_number: 'DEM-5', dispute_status: 'aberto' }] }} />)
    expect(screen.getByText(/Visível no Portal/)).toBeTruthy()
    expect(screen.getByText('Escala omitida')).toBeTruthy()
    expect(screen.getByText(/DEM-5/)).toBeTruthy()
    expect(screen.getByText('Pronto para faturar')).toBeTruthy()
    expect(screen.getByText('Sim')).toBeTruthy()
  })
})
