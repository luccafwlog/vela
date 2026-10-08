// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PortalContactConfiguration } from '../PortalContactConfiguration'
import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'

const getContactConfig = vi.hoisted(() => vi.fn())
const saveContactConfig = vi.hoisted(() => vi.fn())
const auth = vi.hoisted(() => ({
  overview: { customer_id: 10, contact_email: 'fallback@example.com' },
  refreshOverview: vi.fn(),
}))

const scopeRef = vi.hoisted(() => ({
  mode: 'client' as 'client' | 'inspect',
  customerId: null as number | null,
  overview: null,
  basePath: '/portal',
}))

vi.mock('../../../hooks/usePortalAuth', async () => ({
  usePortalAuth: () => auth,
  PortalAuthContext: (await vi.importActual<typeof import('react')>('react')).createContext(auth),
}))

vi.mock('../../../hooks/usePortalScope', () => ({
  usePortalScope: () => scopeRef,
}))

vi.mock('../../../services/portalContactConfiguration', () => ({
  portalGetContactConfiguration: getContactConfig,
  portalSaveContactConfiguration: saveContactConfig,
}))

vi.mock('../../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

function renderComponent(readOnly = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider><PortalContactConfiguration readOnly={readOnly} /></ConfirmDialogProvider>
    </QueryClientProvider>,
  )
}

describe('PortalContactConfiguration', () => {
  beforeEach(() => {
    getContactConfig.mockReset()
    getContactConfig.mockResolvedValue({ boxes: [], contacts: [] })
    saveContactConfig.mockReset()
    auth.refreshOverview.mockReset()
    scopeRef.mode = 'client'
    scopeRef.customerId = null
  })

  it('carrega principal, adicional, telefone, caixas e motivo de endereço bloqueado', async () => {
    getContactConfig.mockResolvedValueOnce({
      boxes: [
        { code: 'documentacao_operacao', label: 'Documentação e Operação', description: 'CE e Taxas', sort_order: 1, active: true },
        { code: 'financeiro', label: 'Financeiro', description: 'Taxas e Demurrage', sort_order: 2, active: true },
        { code: 'demurrage', label: 'Demurrage', description: 'Cobranças Demurrage', sort_order: 3, active: true },
      ],
      contacts: [
        {
          id: 1,
          customer_id: 10,
          name: 'Maria Financeiro',
          email: 'maria@cliente.com',
          phone: '(11) 98888-7777',
          is_primary: true,
          active: true,
          origin: 'portal',
          box_codes: ['documentacao_operacao', 'financeiro', 'demurrage'],
          suppression_reason: null,
          sendable: true,
        },
        {
          id: 2,
          customer_id: 10,
          name: 'João Operação',
          email: 'joao@cliente.com',
          phone: null,
          is_primary: false,
          active: true,
          origin: 'bl_automatico',
          box_codes: ['documentacao_operacao'],
          suppression_reason: 'suprimido_bounce',
          sendable: false,
        },
      ],
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByDisplayValue('Maria Financeiro')).toBeTruthy()
      expect(screen.getByDisplayValue('maria@cliente.com')).toBeTruthy()
      expect(screen.getByDisplayValue('(11) 98888-7777')).toBeTruthy()
      expect(screen.getByDisplayValue('joao@cliente.com')).toBeTruthy()
      expect(screen.getByText('Capturado do B/L')).toBeTruthy()
      expect(screen.getByText(/Endereço bloqueado: Falha permanente na entrega/i)).toBeTruthy()
    })
  })

  it('inclusão de adicional sem caixa é rejeitada no salvamento', async () => {
    const user = userEvent.setup()
    getContactConfig.mockResolvedValueOnce({
      boxes: [
        { code: 'documentacao_operacao', label: 'Documentação e Operação', description: 'CE e Taxas', sort_order: 1, active: true },
        { code: 'financeiro', label: 'Financeiro', description: 'Taxas e Demurrage', sort_order: 2, active: true },
        { code: 'demurrage', label: 'Demurrage', description: 'Cobranças Demurrage', sort_order: 3, active: true },
      ],
      contacts: [
        {
          id: 1,
          name: 'Principal',
          email: 'principal@cliente.com',
          phone: null,
          is_primary: true,
          active: true,
          origin: 'portal',
          box_codes: ['documentacao_operacao', 'financeiro', 'demurrage'],
          suppression_reason: null,
          sendable: true,
        },
      ],
    })

    renderComponent()

    await screen.findByDisplayValue('principal@cliente.com')

    // Clica em Novo contato
    await user.click(screen.getByRole('button', { name: 'Adicionar contato' }))

    // Preenche email do novo contato sem marcar caixas
    const emailInputs = screen.getAllByPlaceholderText('email@empresa.com')
    expect(emailInputs).toHaveLength(2)
    await user.type(emailInputs[1], 'novo@cliente.com')

    // Tenta salvar
    await user.click(screen.getByRole('button', { name: 'Salvar contatos' }))

    expect(
      await screen.findByText(/deve estar vinculado a pelo menos uma caixa/i),
    ).toBeTruthy()
    expect(saveContactConfig).not.toHaveBeenCalled()
  })

  it('salva contatos enviando payload sem customer_id e com box_codes', async () => {
    const user = userEvent.setup()
    getContactConfig.mockResolvedValueOnce({
      boxes: [
        { code: 'documentacao_operacao', label: 'Documentação e Operação', description: 'CE', sort_order: 1, active: true },
        { code: 'financeiro', label: 'Financeiro', description: 'Fin', sort_order: 2, active: true },
        { code: 'demurrage', label: 'Demurrage', description: 'Dem', sort_order: 3, active: true },
      ],
      contacts: [
        {
          id: 1,
          name: 'Principal',
          email: 'principal@cliente.com',
          phone: '119999',
          is_primary: true,
          active: true,
          origin: 'portal',
          box_codes: ['documentacao_operacao', 'financeiro', 'demurrage'],
          suppression_reason: null,
          sendable: true,
        },
      ],
    })
    saveContactConfig.mockResolvedValueOnce({ boxes: [], contacts: [] })

    renderComponent()

    await screen.findByDisplayValue('principal@cliente.com')
    await user.clear(screen.getByDisplayValue('119999'))
    await user.type(screen.getByLabelText(/telefone/i), '118888')
    await user.click(screen.getByRole('button', { name: 'Salvar contatos' }))

    const dialog = await screen.findByRole('dialog', { name: 'Confirmar contatos e recebimento' })
    await user.click(within(dialog).getByRole('button', { name: 'Ver lista (1)' }))
    expect(within(dialog).getByText(/Telefone: 119999 → 118888/)).toBeTruthy()
    expect(saveContactConfig).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Voltar' }))
    expect(saveContactConfig).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Salvar contatos' }))
    const confirmedDialog = await screen.findByRole('dialog', { name: 'Confirmar contatos e recebimento' })
    await user.click(within(confirmedDialog).getByRole('button', { name: 'Salvar contatos' }))

    await waitFor(() => {
      expect(saveContactConfig).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            email: 'principal@cliente.com',
            phone: '118888',
            isPrimary: true,
            boxCodes: ['documentacao_operacao', 'financeiro', 'demurrage'],
          }),
        ]),
        expect.any(Object),
      )
    })
  })

  it('modo Inspeção desabilita edição e botão de salvar', async () => {
    scopeRef.mode = 'inspect'
    scopeRef.customerId = 99
    getContactConfig.mockResolvedValueOnce({
      boxes: [],
      contacts: [
        {
          id: 1,
          name: 'Inspecionado',
          email: 'insp@cliente.com',
          phone: null,
          is_primary: true,
          active: true,
          origin: 'portal',
          box_codes: ['documentacao_operacao', 'financeiro', 'demurrage'],
          suppression_reason: null,
          sendable: true,
        },
      ],
    })

    renderComponent(true)

    await screen.findByDisplayValue('insp@cliente.com')
    expect(screen.queryByRole('button', { name: 'Adicionar contato' })).toBeNull()
    const saveButton = screen.getByRole('button', { name: 'Salvar contatos' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)
  })

  it('modo Inspeção bloqueia a escrita mesmo com submit forçado', async () => {
    scopeRef.mode = 'inspect'
    scopeRef.customerId = 99
    getContactConfig.mockResolvedValueOnce({
      boxes: [],
      contacts: [
        {
          id: 1,
          name: 'Inspecionado',
          email: 'insp@cliente.com',
          phone: null,
          is_primary: true,
          active: true,
          origin: 'portal',
          box_codes: ['documentacao_operacao'],
          suppression_reason: null,
          sendable: true,
        },
      ],
    })

    renderComponent(true)
    await screen.findByDisplayValue('insp@cliente.com')
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).map((box) => box.checked)).toEqual([true, false, false])
    const form = document.querySelector('form')
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await waitFor(() => {
      expect(saveContactConfig).not.toHaveBeenCalled()
    })
  })

  it('save falha quando uma caixa ficaria sem cobertura (sem RPC)', async () => {
    const user = userEvent.setup()
    getContactConfig.mockResolvedValueOnce({
      boxes: [
        { code: 'documentacao_operacao', label: 'Documentação e Operação', description: 'CE', sort_order: 1, active: true },
        { code: 'financeiro', label: 'Financeiro', description: 'Fin', sort_order: 2, active: true },
        { code: 'demurrage', label: 'Demurrage', description: 'Dem', sort_order: 3, active: true },
      ],
      contacts: [
        {
          id: 1,
          name: 'Principal',
          email: 'principal@cliente.com',
          phone: null,
          is_primary: true,
          active: true,
          origin: 'portal',
          box_codes: ['documentacao_operacao', 'financeiro', 'demurrage'],
          suppression_reason: null,
          sendable: false,
        },
      ],
    })

    renderComponent()
    await screen.findByDisplayValue('principal@cliente.com')

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0])
    await user.click(screen.getByRole('button', { name: 'Salvar contatos' }))

    expect(await screen.findByText(/não pode ficar sem nenhum contato/i)).toBeTruthy()
    expect(saveContactConfig).not.toHaveBeenCalled()
  })
  const allBoxes = ['documentacao_operacao', 'financeiro', 'demurrage']
  const principal = {
    id: 1, name: 'Principal', email: 'principal@cliente.com', phone: null,
    is_primary: true, active: true, origin: 'portal', box_codes: allBoxes,
    suppression_reason: null, sendable: true,
  }
  const additional = {
    ...principal, id: 2, name: 'Financeiro', email: 'financeiro@cliente.com',
    is_primary: false, box_codes: ['financeiro'],
  }

  it('marca as três caixas ao carregar principal sem vínculos', async () => {
    getContactConfig.mockResolvedValueOnce({ boxes: [], contacts: [{ ...principal, box_codes: [] }] })
    renderComponent()
    await screen.findByDisplayValue(principal.email)
    expect(screen.getAllByRole('checkbox').every((box) => (box as HTMLInputElement).checked)).toBe(true)
  })

  it('mantém marcada a caixa do principal quando não existe substituto', async () => {
    const user = userEvent.setup()
    getContactConfig.mockResolvedValueOnce({ boxes: [], contacts: [principal] })
    renderComponent()
    await screen.findByDisplayValue(principal.email)
    const checkbox = screen.getAllByRole('checkbox')[1] as HTMLInputElement
    await user.click(checkbox)
    expect(checkbox.checked).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('selecione outro e-mail')
  })

  it.each([
    { active: false },
    { sendable: false },
    { suppression_reason: 'suprimido_bounce' },
    { email: '' },
  ])('não aceita substituto inelegível: %j', async (override) => {
    const user = userEvent.setup()
    getContactConfig.mockResolvedValueOnce({ boxes: [], contacts: [principal, { ...additional, ...override }] })
    renderComponent()
    await screen.findByDisplayValue(principal.email)
    const checkbox = screen.getAllByRole('checkbox')[1] as HTMLInputElement
    await user.click(checkbox)
    expect(checkbox.checked).toBe(true)
  })

  it('permite desmarcar somente a caixa coberta por outro contato elegível', async () => {
    const user = userEvent.setup()
    getContactConfig.mockResolvedValueOnce({ boxes: [], contacts: [principal, additional] })
    renderComponent()
    await screen.findByDisplayValue(principal.email)
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    await user.click(checkboxes[1])
    expect(checkboxes[1].checked).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(checkboxes[1])
    expect(checkboxes[1].checked).toBe(true)
    await user.click(checkboxes[0])
    expect(checkboxes[0].checked).toBe(true)
  })

  it('preserva delegação salva e repõe caixa sem substituto no carregamento', async () => {
    getContactConfig.mockResolvedValueOnce({ boxes: [], contacts: [
      { ...principal, box_codes: ['documentacao_operacao'] }, additional,
    ] })
    renderComponent()
    await screen.findByDisplayValue(principal.email)
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes.slice(0, 3).map((box) => box.checked)).toEqual([true, false, true])
  })

})
