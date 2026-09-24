// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BlReviewContextPanel } from '../BlReviewContextPanel'
import type { BLDetail } from '../../../types/database'

describe('BlReviewContextPanel', () => {
  it('não renderiza nada se o B/L não estiver pendente de revisão', () => {
    const bl = {
      id: 'BL100',
      review_status: 'reviewed',
      customer_id: 1,
      cargo_mode: 'container',
    } as unknown as BLDetail

    const { container } = render(
      <MemoryRouter>
        <BlReviewContextPanel bl={bl} />
      </MemoryRouter>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renderiza o painel contextual com motivos ativos e link para revisão', () => {
    const bl = {
      id: 'BL100',
      review_status: 'pending_review',
      customer_id: null,
      cargo_mode: 'container',
      notes: 'Pendencias de importacao: Cliente nao vinculado, Cliente sem e-mail cadastrado',
    } as unknown as BLDetail

    render(
      <MemoryRouter>
        <BlReviewContextPanel bl={bl} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Pendências documentais')).toBeTruthy()
    expect(screen.getByText('Documentação')).toBeTruthy()
    expect(screen.getByText('Bloqueio de faturamento')).toBeTruthy()
    expect(screen.getByText('Cliente nao vinculado')).toBeTruthy()
    expect(screen.getByText('Cliente sem e-mail cadastrado')).toBeTruthy()
    expect(screen.getByText('Tratar pendência na ficha')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Tratar pendência na ficha/i }).getAttribute('href')).toBe(
      '/revisao?bl=BL100',
    )
  })

  it('exibe motivo computado de peso BB ausente para carga solta', () => {
    const bl = {
      id: 'BL_BB_1',
      review_status: 'pending_review',
      customer_id: 10,
      customer: {
        id: 10,
        name: 'Cliente Teste',
        cnpj_cpf: '12345678000195',
        customer_contacts: [{ id: 1, email: 'teste@example.com' }],
      },
      cargo_mode: 'carga_solta',
      bb_weight_ton: null,
      notes: null,
    } as unknown as BLDetail

    render(
      <MemoryRouter>
        <BlReviewContextPanel bl={bl} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Pendências documentais')).toBeTruthy()
    expect(screen.getByText('Peso BB ausente')).toBeTruthy()
    expect(screen.getByText(/Informe o peso BB na aba Detalhes/i)).toBeTruthy()
  })

  it('não calcula pendência de e-mail para cliente sem contato (migration 085)', () => {
    const bl = {
      id: 'BL_SEM_EMAIL',
      review_status: 'pending_review',
      customer_id: 11,
      customer: { id: 11, name: 'Cliente sem contato', cnpj_cpf: '12345678000195', customer_contacts: [] },
      cargo_mode: 'carga_solta',
      bb_weight_ton: null,
      notes: null,
    } as unknown as BLDetail

    render(
      <MemoryRouter>
        <BlReviewContextPanel bl={bl} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Peso BB ausente')).toBeTruthy()
    expect(screen.queryByText('Cliente sem e-mail cadastrado')).toBeNull()
  })
})
