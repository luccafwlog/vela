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

  it('expõe o estado do card para tecnologia assistiva mesmo quando o detalhe é curto', () => {
    render(<MemoryRouter><BlRailsPipeline operational={[]} documental={[stage('customer', 'Cliente', 'blocked', 'Pendente de reconciliação')]} documentalSummary={{ pendingCount: 1, label: '1 pendência' }} nextAction={null} /></MemoryRouter>)
    const card = screen.getByRole('group', { name: 'Cliente: Bloqueado. Pendente de reconciliação' })
    expect(card).toBeTruthy()
    expect(card.getAttribute('aria-label')).toBe('Cliente: Bloqueado. Pendente de reconciliação')
  })
})
