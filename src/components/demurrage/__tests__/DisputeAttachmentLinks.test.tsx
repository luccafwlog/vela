// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DisputeAttachmentLinks } from '../DisputeAttachmentLinks'

afterEach(cleanup)

function fakeClient(result: { data: { signedUrl: string } | null; error: unknown }) {
  const createSignedUrl = vi.fn().mockResolvedValue(result)
  const from = vi.fn(() => ({ createSignedUrl }))
  return { client: { storage: { from } } as unknown as SupabaseClient, from, createSignedUrl }
}

describe('DisputeAttachmentLinks (DEM-D01)', () => {
  const attachments = [
    { id: 1, file_name: 'comprovante.pdf', mime_type: 'application/pdf', storage_path: '7/disputes/3/9/a-comprovante.pdf' },
    { id: 2, file_name: 'foto.jpg', mime_type: 'image/jpeg', storage_path: '7/disputes/3/9/b-foto.jpg' },
  ]

  it('abre o PDF pelo link temporário do bucket da Disputa e baixa o resto com o nome do arquivo', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const { client, from, createSignedUrl } = fakeClient({ data: { signedUrl: 'https://storage/assinado' }, error: null })
    render(<DisputeAttachmentLinks attachments={attachments} client={client} />)
    fireEvent.click(screen.getByRole('button', { name: 'comprovante.pdf' }))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(from).toHaveBeenCalledWith('demurrage-disputes')
    expect(createSignedUrl).toHaveBeenCalledWith('7/disputes/3/9/a-comprovante.pdf', 60, undefined)
    fireEvent.click(screen.getByRole('button', { name: 'foto.jpg' }))
    await waitFor(() => expect(createSignedUrl).toHaveBeenLastCalledWith('7/disputes/3/9/b-foto.jpg', 60, { download: 'foto.jpg' }))
    click.mockRestore()
  })

  it('sem permissão no Storage, avisa ao lado do anexo e não abre nada', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const { client } = fakeClient({ data: null, error: { message: 'Object not found' } })
    render(<DisputeAttachmentLinks attachments={attachments.slice(0, 1)} client={client} />)
    fireEvent.click(screen.getByRole('button', { name: 'comprovante.pdf' }))
    expect((await screen.findByRole('alert')).textContent).toContain('não foi possível abrir o anexo')
    expect(click).not.toHaveBeenCalled()
    click.mockRestore()
  })
})
