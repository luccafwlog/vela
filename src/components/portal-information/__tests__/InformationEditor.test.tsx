// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InformationEditor } from '../InformationEditor'
const save = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../../../hooks/usePortalInformation', () => ({ useSavePortalInformation: () => ({ mutateAsync: save, isPending: false }) }))
afterEach(() => { cleanup(); save.mockReset().mockResolvedValue(undefined) })
describe('Informações publicadas', () => {
  it('recusa agente sem portos e campos obrigatórios só com espaços', async () => {
    render(<InformationEditor title="Agente" kind="agent" data={{ name: '   ', ports: '' }} fields={[{ key: 'name', label: 'Nome', required: true }, { key: 'ports', label: 'Portos', type: 'list', required: true }]} onClose={() => {}} />)
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar informações' }).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Nome'))
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/Nome/), { target: { value: 'Agente Santos' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar informações' }).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Portos'))
    expect(save).not.toHaveBeenCalled()
  })
  it('recusa publicação de depot sem associação de porto', async () => {
    render(<InformationEditor title="Depot" kind="depot" data={{ id: 'd1', ports: '', published: true }} fields={[{ key: 'ports', label: 'Portos', type: 'list' }, { key: 'published', label: 'Publicado', type: 'boolean' }]} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar informações' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('porto'))
    expect(save).not.toHaveBeenCalled()
  })
  it('recusa URL executável antes de salvar', async () => {
    render(<InformationEditor title="Tracking" kind="carrier" data={{ carrier_id: 1, tracking_url: 'javascript:alert(1)' }} fields={[{ key: 'tracking_url', label: 'URL', type: 'url' }]} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar informações' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('HTTP ou HTTPS'))
    expect(save).not.toHaveBeenCalled()
  })
  it('preserva depot existente e envia associação de portos separada', async () => {
    render(<InformationEditor title="Depot" kind="depot" data={{ id: 'existing', code: 'LEGACY', ports: 'BRSSZ, BRRIO', published: false }} fields={[{ key: 'ports', label: 'Portos', type: 'list' }, { key: 'published', label: 'Publicado', type: 'boolean' }]} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Publicado'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar informações' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ kind: 'depot', data: { id: 'existing', ports: ['BRSSZ', 'BRRIO'], published: true } }))
  })
  it('mantém formulário e mostra erro quando o serviço rejeita a alteração', async () => {
    save.mockRejectedValueOnce(new Error('failure'))
    render(<InformationEditor title="Tracking" kind="carrier" data={{ carrier_id: 1, tracking_url: 'https://carrier.example' }} fields={[{ key: 'tracking_url', label: 'URL', type: 'url' }]} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar informações' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Não foi possível salvar'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
