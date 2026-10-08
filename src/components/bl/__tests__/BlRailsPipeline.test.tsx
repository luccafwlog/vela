// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BlRailsPipeline } from '../BlRailsPipeline'

const stage = (key: string, label: string, state: 'done' | 'pending' | 'blocked', detail = 'x') => ({ key, label, state, detail })

describe('BlRailsPipeline', () => {
  it('mostra os dois trilhos, o resumo documental e a proxima acao', () => {
    render(<MemoryRouter><BlRailsPipeline operational={[stage('pol', 'Saída do POL', 'done'), stage('pod', 'Chegada ao POD', 'pending')]} documental={[stage('customer', 'Cliente', 'done', 'Cliente apto'), stage('ce', 'CE Mercante', 'blocked', 'Pendente · bloqueia emissão e Portal')]} documentalSummary={{ pendingCount: 1, label: '1 pendência' }} nextAction={{ key: 'ce', label: 'CE Mercante', detail: 'Pendente · bloqueia emissão e Portal', state: 'blocked', href: '/bls/BL1?tab=detalhes' }} /></MemoryRouter>)
    expect(screen.getByText('Operacional')).toBeTruthy()
    expect(screen.getByText('Documental')).toBeTruthy()
    expect(screen.getByLabelText('Pendências documentais: 1 pendência')).toBeTruthy()
    expect(screen.queryByText('Financeiro')).toBeNull()
    expect(screen.queryByText('Pagamento')).toBeNull()
    expect(screen.getByText(/Próxima ação/i)).toBeTruthy()
    expect(screen.getAllByText(/Pendente · bloqueia emissão e Portal/).length).toBe(2)
  })

  it('lê o estado de cada etapa em texto e diz para onde a próxima ação leva', () => {
    render(<MemoryRouter><BlRailsPipeline operational={[stage('pol', 'Saída do POL', 'done'), stage('pod', 'Chegada ao POD', 'pending')]} documental={[stage('customer', 'Cliente', 'blocked', 'Pendente de reconciliação')]} documentalSummary={{ pendingCount: 1, label: '1 pendência' }} nextAction={{ key: 'customer', label: 'Cliente', detail: 'Pendente de reconciliação', state: 'blocked', href: '/revisao?bl=BL1' }} /></MemoryRouter>)
    const documental = screen.getByRole('list', { name: 'Trilho documental' })
    expect(documental.textContent).toContain('Pendente de reconciliação: Bloqueada')
    const operational = screen.getByRole('list', { name: 'Trilho operacional' })
    expect(operational.querySelector('[aria-current="step"]')?.textContent).toContain('Chegada ao POD')
    expect(screen.getByRole('link', { name: /Resolver na Revisão/ }).getAttribute('href')).toBe('/revisao?bl=BL1')
  })

  it('sem pendência, confirma em vez de mostrar uma próxima ação vazia', () => {
    render(<MemoryRouter><BlRailsPipeline operational={[]} documental={[stage('customer', 'Cliente', 'done', 'Cliente apto')]} documentalSummary={{ pendingCount: 0, label: 'Sem pendências' }} nextAction={null} /></MemoryRouter>)
    expect(screen.getByRole('status').textContent).toContain('Sem pendências documentais')
    expect(screen.queryByText(/Próxima ação/)).toBeNull()
  })
})
