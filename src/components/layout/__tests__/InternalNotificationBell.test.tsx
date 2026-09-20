// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InternalNotification } from '../../../services/alerts'

const mockNotification: InternalNotification = {
  id: 101,
  alert_id: 1,
  alert_item_id: 1,
  type: 'invoice_overdue',
  item_type: 'invoice_overdue',
  entity_type: 'invoice',
  entity_id: '123',
  title: 'Fatura vencida',
  message: 'Fatura 123 vencida há 5 dias.',
  severity: 'normal',
  read_at: null,
  created_at: '2026-08-20T12:00:00Z',
  payload: null,
}

const mockEchoNotification: InternalNotification = {
  id: 102,
  alert_id: 2,
  alert_item_id: 2,
  type: 'billing_calculation_blocked',
  item_type: 'billing_calculation_blocked',
  entity_type: 'bl',
  entity_id: 'BL999',
  title: 'Pendência dispensada',
  message: 'Pendência dispensada por Operador até 2026-08-27.',
  severity: 'normal',
  read_at: null,
  created_at: '2026-08-20T14:00:00Z',
  payload: { is_echo: true, reason: 'Aguardando cliente', review_at: '2026-08-27' },
}

const mockFallbackNotification: InternalNotification = {
  id: 103,
  alert_id: 3,
  alert_item_id: 3,
  type: 'voyage_baplie_missing',
  item_type: 'voyage_baplie_missing',
  entity_type: 'voyage',
  entity_id: '88',
  title: 'Baplie ausente',
  message: 'Baplie não encontrado para viagem 88',
  severity: 'critical',
  is_fallback: true,
  read_at: null,
  created_at: '2026-08-20T15:00:00Z',
  payload: null,
}

const mutateMarkReadMock = vi.fn().mockResolvedValue(undefined)
const mutateMarkAllReadMock = vi.fn().mockResolvedValue(1)
const showToastMock = vi.fn()

// O sino recebe so a chave surrogate em `entity_id`; os rotulos chegam por uma
// consulta separada, exatamente como na fila de /alertas.
const entityLabels: Record<string, string> = {
  'invoice:123': 'FAT-2026-0123',
  'voyage:88': 'MSC LUCIA / 24W',
}

vi.mock('../../../hooks/useInternalNotifications', () => ({
  useUnreadInternalNotificationCount: () => ({ data: 3 }),
  useInternalNotificationEntityLabels: () => ({ data: entityLabels }),
  useInternalNotifications: (open: boolean) => ({
    data: open ? [mockNotification, mockEchoNotification, mockFallbackNotification] : [],
    isLoading: false,
  }),
  useMarkInternalNotificationRead: () => ({
    mutateAsync: mutateMarkReadMock,
    isPending: false,
  }),
  useMarkAllInternalNotificationsRead: () => ({
    mutateAsync: mutateMarkAllReadMock,
    isPending: false,
  }),
}))

vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ showToast: showToastMock }),
}))

import { InternalNotificationBell } from '../InternalNotificationBell'

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
})

describe('InternalNotificationBell', () => {
  it('renderiza o badge com a contagem de não lidas', () => {
    render(
      <MemoryRouter>
        <InternalNotificationBell />
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('Notificações internas (3 não lidas)')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('abre o painel ao clicar no sino e usa linguagem operacional em português', () => {
    render(
      <MemoryRouter>
        <InternalNotificationBell />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByLabelText('Notificações internas (3 não lidas)'))

    expect(screen.getByText('Notificações internas')).toBeTruthy()
    expect(screen.getByText('Fatura vencida')).toBeTruthy()
    expect(screen.getByText('Eco de Tratamento')).toBeTruthy()
    expect(screen.getByText('Entrega alternativa')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Notificações internas' })).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByText('Marcar todas como lidas')).toBeTruthy()
  })

  it('traduz a chave surrogate da entidade para o rotulo humano', () => {
    render(
      <MemoryRouter>
        <InternalNotificationBell />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByLabelText('Notificações internas (3 não lidas)'))

    expect(screen.getByText('Fatura FAT-2026-0123')).toBeTruthy()
    expect(screen.getByText('Viagem MSC LUCIA / 24W')).toBeTruthy()
    // B/L ja e chave natural: continua saindo cru.
    expect(screen.getByText('B/L BL999')).toBeTruthy()
    expect(screen.queryByText('Fatura 123')).toBeNull()
    expect(screen.queryByText('Viagem 88')).toBeNull()
  })

  it('marca todas como lidas ao acionar o botão de baixa em massa', async () => {
    render(
      <MemoryRouter>
        <InternalNotificationBell />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByLabelText('Notificações internas (3 não lidas)'))
    fireEvent.click(screen.getByText('Marcar todas como lidas'))

    expect(mutateMarkAllReadMock).toHaveBeenCalledTimes(1)
  })

  it('marca uma notificação individual como lida ao clicar', () => {
    render(
      <MemoryRouter>
        <InternalNotificationBell />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByLabelText('Notificações internas (3 não lidas)'))
    fireEvent.click(screen.getByText('Fatura 123 vencida há 5 dias.'))

    expect(mutateMarkReadMock).toHaveBeenCalledWith(101)
  })

  it('não oferece ações de dispensar, fechar ou reconhecer alerta no sino', () => {
    render(
      <MemoryRouter>
        <InternalNotificationBell />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByLabelText('Notificações internas (3 não lidas)'))

    expect(screen.queryByText('Dispensar')).toBeNull()
    expect(screen.queryByText('Reconhecer')).toBeNull()
    expect(screen.queryByText('Fechar')).toBeNull()
  })

  it('fecha o menu ao pressionar Escape', () => {
    render(
      <MemoryRouter>
        <InternalNotificationBell />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByLabelText('Notificações internas (3 não lidas)'))
    expect(screen.getByText('Notificações internas')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Notificações internas')).toBeNull()
  })

  it('falha ao marcar como lida avisa e permite retry sem duplicar', async () => {
    mutateMarkReadMock.mockRejectedValueOnce(new Error('rede'))
    render(
      <MemoryRouter>
        <InternalNotificationBell />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByLabelText('Notificações internas (3 não lidas)'))
    fireEvent.click(screen.getByText('Fatura 123 vencida há 5 dias.'))

    expect(mutateMarkReadMock).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith(expect.stringMatching(/marcar como lida/i), 'error'))

    // O clique fecha o menu por desenho; reabrir mostra o item ainda não
    // lido e único: retry não duplica a notificação.
    fireEvent.click(screen.getByLabelText('Notificações internas (3 não lidas)'))
    expect(screen.getAllByText('Fatura vencida')).toHaveLength(1)
    fireEvent.click(screen.getByText('Fatura 123 vencida há 5 dias.'))
    expect(mutateMarkReadMock).toHaveBeenCalledTimes(2)
  })

  it('falha ao marcar todas como lidas avisa sem engolir o erro', async () => {
    mutateMarkAllReadMock.mockRejectedValueOnce(new Error('rede'))
    render(
      <MemoryRouter>
        <InternalNotificationBell />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByLabelText('Notificações internas (3 não lidas)'))
    fireEvent.click(screen.getByText('Marcar todas como lidas'))

    expect(mutateMarkAllReadMock).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith(expect.stringMatching(/todas como lidas/i), 'error'))
  })

  it('fecha o menu ao clicar fora', () => {
    render(
      <MemoryRouter>
        <div>
          <button type="button">Fora</button>
          <InternalNotificationBell />
        </div>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByLabelText('Notificações internas (3 não lidas)'))
    expect(screen.getByText('Notificações internas')).toBeTruthy()

    fireEvent.mouseDown(screen.getByText('Fora'))
    expect(screen.queryByText('Notificações internas')).toBeNull()
  })
})
