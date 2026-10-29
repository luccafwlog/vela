// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ anchor: vi.fn(), setRoe: vi.fn(), confirm: vi.fn(), showToast: vi.fn(), role: 'equipamentos' as string }))
vi.mock('../../../services/blDemurrageConfig', () => ({ setBlManualRoe: mocks.setRoe }))
vi.mock('../../../services/demurrage/demurrageContainers', () => ({ readDemurrageGroupAnchor: mocks.anchor }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ effectiveRole: mocks.role }) }))

import { BlManualRoe } from '../BlManualRoe'

function renderRoe(props: { roe: number | null; manual: boolean }) {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><BlManualRoe blId="BL-1" {...props} /></QueryClientProvider></MemoryRouter>)
}

beforeEach(() => {
  mocks.anchor.mockResolvedValue('BL-1')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.role = 'equipamentos'
})

describe('BlManualRoe (migration 435)', () => {
  it('Equipamentos define o ROE manual do B/L com motivo', async () => {
    mocks.setRoe.mockResolvedValue(undefined)
    mocks.confirm.mockResolvedValue(true)
    const user = userEvent.setup()
    renderRoe({ roe: null, manual: false })

    expect(screen.getByText('Sem ROE manual: a Invoice segue a PTAX do dia')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Definir ROE manual…' }))
    const submit = screen.getByRole('button', { name: 'Definir ROE manual' }) as HTMLButtonElement
    await user.type(screen.getByLabelText(/ROE manual \(R\$ por US\$\)/), '5,8123')
    expect(submit.disabled).toBe(true)
    await user.type(screen.getByLabelText(/Motivo do ROE manual/), 'Câmbio combinado com o armador')
    await user.click(submit)

    expect(mocks.setRoe).toHaveBeenCalledWith({ blId: 'BL-1', roe: 5.8123, reason: 'Câmbio combinado com o armador' })
    expect(mocks.showToast).toHaveBeenCalledWith('ROE manual do B/L definido.', 'success')
  })

  it('tira o ROE manual com motivo', async () => {
    mocks.setRoe.mockResolvedValue(undefined)
    mocks.confirm.mockResolvedValue(true)
    const user = userEvent.setup()
    renderRoe({ roe: 5.9, manual: true })

    expect(screen.getByText('5,9000')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Tirar ROE manual…' }))
    await user.type(screen.getByLabelText(/Motivo para tirar o ROE manual/), 'Cliente pediu a PTAX do dia')
    await user.click(screen.getByRole('button', { name: 'Tirar ROE manual' }))

    expect(mocks.setRoe).toHaveBeenCalledWith({ blId: 'BL-1', roe: null, reason: 'Cliente pediu a PTAX do dia' })
  })

  it('ROE em formato inválido não chega ao banco', async () => {
    const user = userEvent.setup()
    renderRoe({ roe: null, manual: false })

    await user.click(await screen.findByRole('button', { name: 'Definir ROE manual…' }))
    await user.type(screen.getByLabelText(/ROE manual \(R\$ por US\$\)/), '1e1')
    await user.type(screen.getByLabelText(/Motivo do ROE manual/), 'Câmbio combinado com o armador')
    await user.click(screen.getByRole('button', { name: 'Definir ROE manual' }))

    expect(screen.getByRole('alert').textContent).toContain('Informe o ROE')
    expect(mocks.setRoe).not.toHaveBeenCalled()
  })

  it('Operações vê o ROE manual, sem a ação', () => {
    mocks.role = 'operacoes'
    renderRoe({ roe: 5.9, manual: true })

    expect(screen.getByText('5,9000')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /ROE manual/ })).toBeNull()
  })

  it('B/L fora do âncora do grupo não oferece definir nem trocar e aponta o B/L emissor', async () => {
    mocks.anchor.mockResolvedValue('BL-0')
    renderRoe({ roe: null, manual: false })

    const link = await screen.findByRole('link', { name: 'BL-0' })
    expect(link.getAttribute('href')).toBe('/bls/BL-0?tab=faturamento')
    expect(screen.queryByRole('button', { name: 'Definir ROE manual…' })).toBeNull()
    expect(mocks.anchor).toHaveBeenCalledWith('BL-1')
  })

  it('B/L fora do âncora com ROE manual antigo só pode tirá-lo', async () => {
    mocks.anchor.mockResolvedValue('BL-0')
    renderRoe({ roe: 5.9, manual: true })

    await screen.findByRole('link', { name: 'BL-0' })
    expect(screen.queryByRole('button', { name: 'Trocar ROE manual…' })).toBeNull()
    expect(await screen.findByRole('button', { name: 'Tirar ROE manual…' })).toBeTruthy()
  })

  it('enquanto o âncora carrega, não oferece definir', async () => {
    mocks.anchor.mockReturnValue(new Promise(() => {}))
    renderRoe({ roe: null, manual: false })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('button', { name: 'Definir ROE manual…' })).toBeNull()
  })

  it('falha ao ler o âncora: não oferece definir e avisa', async () => {
    mocks.anchor.mockRejectedValue(new Error('rede'))
    render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BlManualRoe blId="BL-1" roe={null} manual={false} /></QueryClientProvider></MemoryRouter>)

    expect((await screen.findByRole('alert')).textContent).toMatch(/Não foi possível ver qual B\/L emite/)
    expect(screen.queryByRole('button', { name: 'Definir ROE manual…' })).toBeNull()
  })

  it('formulário aberto fecha quando o âncora passa a ser outro B/L', async () => {
    const client = new QueryClient()
    const user = userEvent.setup()
    render(<MemoryRouter><QueryClientProvider client={client}><BlManualRoe blId="BL-1" roe={null} manual={false} /></QueryClientProvider></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Definir ROE manual…' }))
    expect(screen.getByLabelText(/ROE manual \(R\$ por US\$\)/)).toBeTruthy()

    mocks.anchor.mockResolvedValue('BL-0')
    await client.invalidateQueries()
    await screen.findByRole('link', { name: 'BL-0' })
    expect(screen.queryByLabelText(/ROE manual \(R\$ por US\$\)/)).toBeNull()
  })
})
