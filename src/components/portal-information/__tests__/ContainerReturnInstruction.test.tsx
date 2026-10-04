// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContainerReturnInstruction } from '../ContainerReturnInstruction'
const mocks = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue(undefined), role: 'equipamentos', status: 'specific', available: true }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ profile: { role: mocks.role, active: true }, isAdmin: false }) }))
vi.mock('../../../hooks/usePortalInformation', () => ({
  useInternalPortalInformation: () => ({ data: { depots: [
    { id: 'd1', name: 'Depot Santos', code: 'S', ports: ['BRSSZ'], active: mocks.available, published: true },
    { id: 'd2', name: 'Outro porto', ports: ['BRRIO'], active: true, published: true },
    { id: 'd4', name: 'Segundo depot', ports: ['BRSSZ'], active: true, published: true },
    { id: 'd3', name: 'Não publicado', ports: ['BRSSZ'], active: true, published: false },
  ] }, isLoading: false }),
  useInternalReturnGuidance: () => ({ data: { status: mocks.status, pod: 'BRSSZ', depots: mocks.status === 'unavailable' ? [] : [{ id: 'd1', name: 'Depot Santos' }], updated_at: 'same' }, isLoading: false }),
  useSetContainerReturnInstruction: () => ({ mutateAsync: mocks.save, isPending: false }),
}))
afterEach(() => { cleanup(); mocks.save.mockClear(); mocks.role = 'equipamentos'; mocks.status = 'specific'; mocks.available = true })
describe('Indicação de devolução', () => {
  it('permite retirar indicação indisponível após atualização sem mudança do timestamp', async () => {
    const { rerender } = render(<ContainerReturnInstruction containerId={17} containerNumber="ABCD1234567" onClose={() => {}} />)
    mocks.status = 'unavailable'; mocks.available = false
    rerender(<ContainerReturnInstruction containerId={17} containerNumber="ABCD1234567" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/Justificativa/), { target: { value: 'Restaurar opções disponíveis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar indicação' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ containerId: 17, depotIds: [], reason: 'Restaurar opções disponíveis' }))
  })
  it('preserva seleção e justificativa em atualização sem mudança da disponibilidade', () => {
    const { rerender } = render(<ContainerReturnInstruction containerId={17} containerNumber="ABCD1234567" onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Segundo depot'))
    fireEvent.change(screen.getByLabelText(/Justificativa/), { target: { value: 'Em edição' } })
    rerender(<ContainerReturnInstruction containerId={17} containerNumber="ABCD1234567" onClose={() => {}} />)
    expect((screen.getByLabelText('Segundo depot') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(/Justificativa/) as HTMLTextAreaElement).value).toBe('Em edição')
  })
  it('remove indicação com justificativa e não oferece depots de outro porto ou despublicados', async () => {
    render(<ContainerReturnInstruction containerId={17} containerNumber="ABCD1234567" onClose={() => {}} />)
    expect(screen.queryByText('Outro porto')).toBeNull()
    expect(screen.queryByText('Não publicado')).toBeNull()
    fireEvent.click(screen.getByLabelText('Depot Santos'))
    expect((screen.getByRole('button', { name: 'Salvar indicação' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Justificativa/), { target: { value: 'Restaurar regra geral' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar indicação' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ containerId: 17, depotIds: [], reason: 'Restaurar regra geral' }))
  })
  it('salva indicação múltipla para a unidade informada', async () => {
    render(<ContainerReturnInstruction containerId={17} containerNumber="ABCD1234567" onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Segundo depot'))
    fireEvent.change(screen.getByLabelText(/Justificativa/), { target: { value: 'Duas opções autorizadas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar indicação' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ containerId: 17, depotIds: ['d1', 'd4'], reason: 'Duas opções autorizadas' }))
  })
  it('consulta sem permissão de alteração', () => {
    mocks.role = 'documentacao'
    render(<ContainerReturnInstruction containerId={17} containerNumber="ABCD1234567" onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Salvar indicação' })).toBeNull()
    expect(screen.getByText('Depot Santos')).toBeTruthy()
  })
  it('SOC não permite indicar depot', () => {
    mocks.status = 'soc'
    render(<ContainerReturnInstruction containerId={17} containerNumber="ABCD1234567" onClose={() => {}} />)
    expect(screen.getByText('Container SOC: não exige devolução.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Salvar indicação' })).toBeNull()
  })
})
