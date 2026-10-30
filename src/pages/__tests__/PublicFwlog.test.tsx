// @vitest-environment jsdom

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// ADR 0112: as páginas públicas não usam sessão nem o cliente do Supabase.
const { supabaseRpc } = vi.hoisted(() => ({ supabaseRpc: vi.fn() }))
vi.mock('../../services/supabase', () => ({
  supabase: { rpc: supabaseRpc },
  supabasePortal: { rpc: supabaseRpc, functions: { invoke: supabaseRpc } },
}))
vi.mock('../../hooks/usePortalOperation', () => ({
  usePortalOperationBls: () => { throw new Error('a página pública não pode ler os B/Ls do Portal') },
}))

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock('../../lib/featureFlags', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/featureFlags')>()
  return { ...original, featureFlags: { isEnabled: () => false, capture } }
})

// Turnstile falso: cada rodada (`resetKey`) entrega um token novo.
const challenge = vi.hoisted(() => ({ failRounds: new Set<number>() }))
vi.mock('../../components/security/TurnstileChallenge', () => ({
  TurnstileChallenge: ({ onToken, onError, resetKey = 0, action, siteKey }: { onToken: (token: string) => void; onError: (message: string) => void; resetKey?: number; action: string; siteKey?: string }) => {
    useEffect(() => {
      if (challenge.failRounds.has(resetKey)) onError('Não foi possível validar a segurança.')
      else onToken(`${action}-${siteKey}-${resetKey}`)
    }, [action, siteKey, resetKey, onToken, onError])
    return null
  },
}))

import { PublicChegadasSaidas } from '../PublicChegadasSaidas'
import { PublicConsultaContainer } from '../PublicConsultaContainer'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://projeto.supabase.co')
  vi.stubEnv('VITE_TURNSTILE_PUBLIC_SITE_KEY', 'chave-publica')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  supabaseRpc.mockReset()
  challenge.failRounds.clear()
  capture.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const SCHEDULE = {
  updated_at: '2026-10-23T18:05:00Z',
  voyages: [
    { vessel_name: 'NAVIO A', voyage: '001', imo: '9514001', calls: [
      { port_code: 'CNSHA', kind: 'pol', date: '2026-09-01', actual: '2026-09-02', omitted: false },
      { port_code: 'BRSUA', kind: 'pod', date: '2099-10-20', actual: null, omitted: false },
    ] },
    { vessel_name: 'NAVIO B', voyage: '002', imo: null, calls: [
      { port_code: 'BRSSA', kind: 'pod', date: '2099-11-01', actual: null, omitted: false },
    ] },
  ],
}

function renderPage(element: React.ReactElement) {
  return render(<MemoryRouter>{element}</MemoryRouter>)
}

it('quadro público: mesmo bloco do Portal, com Suape e MarineTraffic só com IMO, sem "Meus B/Ls" nem sessão', async () => {
  fetchMock.mockResolvedValue(json(SCHEDULE))
  renderPage(<PublicChegadasSaidas />)

  const table = await screen.findByRole('table')
  expect(within(table).getByRole('columnheader', { name: 'Suape ETA' })).toBeTruthy()
  expect(within(table).getAllByRole('row')).toHaveLength(3)
  const maps = within(table).getAllByRole('link', { name: /MarineTraffic/ })
  expect(maps).toHaveLength(1)
  expect(maps[0].getAttribute('href')).toBe('https://www.marinetraffic.com/en/ais/details/ships/imo:9514001')
  expect(maps[0].getAttribute('target')).toBe('_blank')
  expect(maps[0].getAttribute('rel')).toBe('noopener noreferrer')
  expect(screen.queryByText(/Meus B\/Ls/)).toBeNull()
  expect(screen.queryByText(/Vela/)).toBeNull()
  expect(screen.getByRole('status').textContent).toBe('Atualizado em 23/10/2026 às 15:05 (horário de Brasília)')

  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('https://projeto.supabase.co/functions/v1/public-ship-schedule')
  expect(JSON.parse(String(init?.body))).toEqual({ turnstile_token: 'schedule-chave-publica-0' })
  expect(new Headers(init?.headers).has('apikey')).toBe(false)
  expect(new Headers(init?.headers).has('authorization')).toBe(false)
  expect(supabaseRpc).not.toHaveBeenCalled()

  // Atualizar pede uma verificação nova.
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ turnstile_token: 'schedule-chave-publica-1' })
})

it('quadro público: limite atingido avisa sem mostrar dado velho como novo', async () => {
  fetchMock.mockResolvedValue(json({ error: 'limite_atingido' }, 429))
  renderPage(<PublicChegadasSaidas />)
  expect(await screen.findByText('Muitas atualizações seguidas. Aguarde alguns minutos e tente de novo.')).toBeTruthy()
})

it('sem a Site Key pública, as duas páginas ficam indisponíveis e não chamam a Edge', async () => {
  vi.stubEnv('VITE_TURNSTILE_PUBLIC_SITE_KEY', '')
  const first = renderPage(<PublicChegadasSaidas />)
  expect(await screen.findByText('Chegadas e saídas indisponível no momento. Tente mais tarde.')).toBeTruthy()
  first.unmount()
  renderPage(<PublicConsultaContainer />)
  expect(screen.getByText('Consulta indisponível no momento. Tente mais tarde.')).toBeTruthy()
  expect(fetchMock).not.toHaveBeenCalled()
})

it('consulta: dígito verificador errado é recusado no navegador, sem gastar consulta', async () => {
  renderPage(<PublicConsultaContainer />)
  await userEvent.type(screen.getByLabelText(/Número do container/), 'CSQU3054384')
  await userEvent.click(screen.getByRole('button', { name: 'Consultar' }))
  expect(screen.getByText(/Confira o número/)).toBeTruthy()
  expect(fetchMock).not.toHaveBeenCalled()
})

it('consulta: encontrado mostra só os campos da lista positiva; o token vale uma consulta', async () => {
  fetchMock.mockResolvedValueOnce(json({
    found: true,
    consulted_at: '2026-10-23T18:05:00Z',
    container: {
      number: 'CSQU3054383', type: '40HC', vessel_name: 'NAVIO A', voyage: '001', discharge_port: 'BRSUA',
      discharge_date: '2026-10-20', return_date: null, free_time_days: 14, free_time_until: '2026-11-03', situation: 'no_prazo',
    },
  }))
  renderPage(<PublicConsultaContainer />)
  await userEvent.type(screen.getByLabelText(/Número do container/), 'csqu 305438-3')
  await userEvent.click(screen.getByRole('button', { name: 'Consultar' }))

  const result = await screen.findByRole('region', { name: 'Container CSQU3054383' })
  expect(within(result).getByText('Dentro do free time')).toBeTruthy()
  expect(within(result).getByText('Suape')).toBeTruthy()
  expect(within(result).getByText('14 dias')).toBeTruthy()
  expect(within(result).getAllByText(/03\/11\/2026/).length).toBeGreaterThan(0)
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ container_number: 'CSQU3054383', turnstile_token: 'lookup-chave-publica-0' })

  fetchMock.mockResolvedValueOnce(json({ found: false }))
  await userEvent.click(screen.getByRole('button', { name: 'Consultar' }))
  expect(await screen.findByText(/Não encontramos este container\. Containers de Salvador, Vitória, Pecém e Suape: descarregados ou previstos nos últimos 90 dias e os que ainda não foram devolvidos\./)).toBeTruthy()
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).turnstile_token).toBe('lookup-chave-publica-1')
  expect(supabaseRpc).not.toHaveBeenCalled()
})

it('quadro público: verificação que falha sai do carregando e Tentar novamente pede outra', async () => {
  challenge.failRounds.add(0)
  fetchMock.mockResolvedValue(json(SCHEDULE))
  renderPage(<PublicChegadasSaidas />)
  expect(await screen.findByText('Não foi possível validar a segurança.')).toBeTruthy()
  expect(fetchMock).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByRole('table')).toBeTruthy()
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ turnstile_token: 'schedule-chave-publica-1' })
})

it('consulta: verificação que falhou é refeita ao tentar consultar', async () => {
  challenge.failRounds.add(0)
  fetchMock.mockResolvedValue(json({ found: false }))
  renderPage(<PublicConsultaContainer />)
  await userEvent.type(screen.getByLabelText(/Número do container/), 'CSQU3054383')
  await userEvent.click(screen.getByRole('button', { name: 'Consultar' }))
  expect(screen.getByText('Não foi possível validar a segurança.')).toBeTruthy()
  expect(fetchMock).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Consultar' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).turnstile_token).toBe('lookup-chave-publica-1')
})

it('PostHog: quadro aberto e resultado da consulta, sem o número do container', async () => {
  fetchMock.mockResolvedValueOnce(json(SCHEDULE))
  const schedule = renderPage(<PublicChegadasSaidas />)
  await screen.findByRole('table')
  expect(capture).toHaveBeenCalledWith('public_schedule_viewed', { surface: 'public' })
  schedule.unmount()

  fetchMock.mockResolvedValueOnce(json({ found: false }))
  renderPage(<PublicConsultaContainer />)
  await userEvent.type(screen.getByLabelText(/Número do container/), 'CSQU3054384')
  await userEvent.click(screen.getByRole('button', { name: 'Consultar' }))
  await userEvent.clear(screen.getByLabelText(/Número do container/))
  await userEvent.type(screen.getByLabelText(/Número do container/), 'CSQU3054383')
  await userEvent.click(screen.getByRole('button', { name: 'Consultar' }))
  await screen.findByText(/Não encontramos este container/)
  expect(capture.mock.calls.slice(1)).toEqual([
    ['public_container_lookup', { surface: 'public', lookup_outcome: 'invalid_number' }],
    ['public_container_lookup', { surface: 'public', lookup_outcome: 'not_found' }],
  ])
  expect(JSON.stringify(capture.mock.calls)).not.toContain('CSQU')
})
