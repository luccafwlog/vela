import { describe, expect, it, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()

vi.mock('../supabase', () => ({
  supabasePortal: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}))

import { portalUploadDisputeAttachment } from '../portalBilling'
import type { PortalScope } from '../portalScope'

describe('portalUploadDisputeAttachment (PAF-02/03)', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('recusa tipo de arquivo fora da allowlist', async () => {
    const file = new File(['hello'], 'script.sh', { type: 'application/x-sh' })
    await expect(portalUploadDisputeAttachment(1, 2, 3, file)).rejects.toThrow(
      'Anexo inválido. Use PDF, JPG, PNG ou TXT de até 10 MB.',
    )
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('recusa arquivo maior que 10 MB', async () => {
    const bigContent = new Uint8Array(10 * 1024 * 1024 + 1)
    const file = new File([bigContent], 'large.pdf', { type: 'application/pdf' })
    await expect(portalUploadDisputeAttachment(1, 2, 3, file)).rejects.toThrow(
      'Anexo inválido. Use PDF, JPG, PNG ou TXT de até 10 MB.',
    )
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('bloqueia upload quando executado em Modo Inspeção', async () => {
    const file = new File(['content'], 'doc.pdf', { type: 'application/pdf' })
    const inspectionScope: PortalScope = {
      mode: 'inspect',
      customerId: 42,
      overview: null,
      basePath: '/clientes/portal',
    }
    await expect(portalUploadDisputeAttachment(1, 2, 42, file, inspectionScope)).rejects.toThrow(
      'Upload de anexo indisponível em Modo Inspeção.',
    )
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('envia FormData para a Edge Function portal-dispute-attachment e retorna metadados', async () => {
    const file = new File(['dummy-pdf'], 'documento.pdf', { type: 'application/pdf' })
    invokeMock.mockResolvedValueOnce({
      data: { id: 99, file_name: 'documento.pdf', size_bytes: file.size },
      error: null,
    })

    const result = await portalUploadDisputeAttachment(10, 20, 30, file)

    expect(invokeMock).toHaveBeenCalledTimes(1)
    const [functionName, options] = invokeMock.mock.calls[0]
    expect(functionName).toBe('portal-dispute-attachment')
    expect(options.body).toBeInstanceOf(FormData)
    expect((options.body as FormData).get('message_id')).toBe('10')
    expect((options.body as FormData).get('dispute_id')).toBe('20')
    expect((options.body as FormData).get('customer_id')).toBe('30')
    expect(result).toEqual({ id: 99, file_name: 'documento.pdf', size_bytes: file.size })
  })

  it('propaga mensagem de erro retornada pela Edge Function', async () => {
    const file = new File(['dummy'], 'nota.txt', { type: 'text/plain' })
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Quota de armazenamento de anexos de 100 MB excedida.' },
    })

    await expect(portalUploadDisputeAttachment(10, 20, 30, file)).rejects.toThrow(
      'Quota de armazenamento de anexos de 100 MB excedida.',
    )
  })
})
