// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BlRailsPipeline } from '../BlRailsPipeline'

const stage = (key: string, label: string, state: 'done' | 'pending' | 'blocked', detail = 'x') => ({ key, label, state, detail })

describe('BlRailsPipeline', () => {
  it('mostra a próxima ação em faixa própria e os dois trilhos em blocos', () => {
    render(<MemoryRouter><BlRailsPipeline operational={[stage('pol', 'Saída do POL', 'done'), stage('discharge', 'Descarga', 'done', '2/2 descarregados')]} documental={[stage('customer', 'Cliente', 'done', 'Cliente apto'), stage('ce', 'CE Mercante', 'blocked', 'Pendente · bloqueia emissão e Portal')]} documentalSummary={{ pendingCount: 1, label: '1 pendência' }} nextAction={{ key: 'ce', label: 'CE Mercante', detail: 'Pendente · bloqueia emissão e Portal', state: 'blocked', href: '/bls/BL1?tab=detalhes' }} /></MemoryRouter>)
    const next = screen.getByRole('region', { name: 'Próxima ação' })
    expect(next.className).toContain('app-next-action--danger')
    expect(next.textContent).toContain('CE Mercante: Pendente · bloqueia emissão e Portal')
    const operational = screen.getByRole('region', { name: 'Operacional' })
    expect(within(operational).getByText('2/2 descarregados', { selector: '.app-block__aside' })).toBeTruthy()
    const documental = screen.getByRole('region', { name: 'Documental' })
    expect(within(documental).getByText('1 pendência')).toBeTruthy()
    expect(screen.queryByText('Financeiro')).toBeNull()
  })

  it('lê o estado de cada etapa em texto e a próxima ação é um botão com o destino', () => {
    render(<MemoryRouter><BlRailsPipeline operational={[stage('pol', 'Saída do POL', 'done'), stage('pod', 'Chegada ao POD', 'pending')]} documental={[stage('customer', 'Cliente', 'blocked', 'Pendente de reconciliação')]} documentalSummary={{ pendingCount: 1, label: '1 pendência' }} nextAction={{ key: 'customer', label: 'Cliente', detail: 'Pendente de reconciliação', state: 'blocked', href: '/revisao?bl=BL1' }} /></MemoryRouter>)
    const documental = screen.getByRole('list', { name: 'Trilho documental' })
    expect(documental.textContent).toContain('Pendente de reconciliação: Bloqueada')
    const operational = screen.getByRole('list', { name: 'Trilho operacional' })
    expect(operational.querySelector('[aria-current="step"]')?.textContent).toContain('Chegada ao POD')
    const link = screen.getByRole('link', { name: /Resolver na Revisão/ })
    expect(link.getAttribute('href')).toBe('/revisao?bl=BL1')
    expect(link.className).toContain('app-btn')
  })

  it('pendência simples fica em âmbar', () => {
    render(<MemoryRouter><BlRailsPipeline operational={[]} documental={[stage('charges', 'Taxas Locais', 'pending', 'Não calculado')]} documentalSummary={{ pendingCount: 1, label: '1 pendência' }} nextAction={{ key: 'charges', label: 'Taxas Locais', detail: 'Não calculado', state: 'pending', href: '/bls/BL1?tab=faturamento' }} /></MemoryRouter>)
    expect(screen.getByRole('region', { name: 'Próxima ação' }).className).toContain('app-next-action--warning')
  })

  it('sem pendência, não mostra faixa de próxima ação e o bloco Documental confirma', () => {
    render(<MemoryRouter><BlRailsPipeline operational={[]} documental={[stage('customer', 'Cliente', 'done', 'Cliente apto')]} documentalSummary={{ pendingCount: 0, label: 'Sem pendências' }} nextAction={null} /></MemoryRouter>)
    expect(screen.queryByRole('region', { name: 'Próxima ação' })).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Documental' })).getByText('Sem pendências')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Operacional' })).toBeNull()
  })
})
