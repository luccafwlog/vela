// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ReturnGuidanceView } from '../ReturnGuidanceView'
import type { PortalDepot, ReturnGuidance } from '../../../../services/portalInformation'

afterEach(cleanup)
const depot: PortalDepot = { id: 'a', code: 'DEP', name: 'Depot autorizado', ports: ['BRSSZ'], address: 'Rua do Porto', opening_hours: '08h às 17h', emails: [], phones: [], scheduling_url: 'javascript:alert(1)', instructions: 'Agende antes da chegada', restrictions: 'Não recebe avariados', published: true, active: true, updated_at: null }
const guidance: ReturnGuidance = { container_id: 1, container_number: 'ABCD1234567', bl_id: 'BL1', pod: 'BRSSZ', return_date: null, status: 'specific', depots: [depot], updated_at: null }
describe('Orientação de devolução', () => {
  it('mostra somente os depots da indicação e mantém restrições sem link inseguro', () => {
    render(<ReturnGuidanceView guidance={guidance} />)
    expect(screen.getByText('Depot autorizado')).toBeTruthy()
    expect(screen.getByText('Não recebe avariados')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /agendamento/i })).toBeNull()
    expect(screen.getByText(/Indicação específica/)).toBeTruthy()
  })
  it('não apresenta depot como alternativa quando a indicação está indisponível', () => {
    render(<ReturnGuidanceView guidance={{ ...guidance, status: 'unavailable', depots: [depot] }} />)
    expect(screen.getByRole('alert').textContent).toContain('atendimento')
    expect(screen.queryByText('Depot autorizado')).toBeNull()
  })
  it('informa que SOC não exige devolução sem mostrar depots', () => {
    render(<ReturnGuidanceView guidance={{ ...guidance, status: 'soc' }} />)
    expect(screen.getByText(/SOC.*não exige devolução/)).toBeTruthy()
    expect(screen.queryByText('Depot autorizado')).toBeNull()
  })
  it('explicita ausência de depot publicado na regra geral', () => {
    render(<ReturnGuidanceView guidance={{ ...guidance, status: 'general', depots: [] }} />)
    expect(screen.getByText('Sem depots disponíveis')).toBeTruthy()
  })
})
