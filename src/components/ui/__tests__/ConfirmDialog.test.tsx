// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfirmDialogProvider, useConfirmWithReason } from '../ConfirmDialog'

afterEach(cleanup)

// ADR 0072: o dialogo mostra o que sera feito, os registros afetados, a
// consequencia e se da para desfazer, e exige motivo antes de executar.
function Harness() {
  const confirmWithReason = useConfirmWithReason()
  const [result, setResult] = useState('pendente')
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const reason = await confirmWithReason({
            title: 'Excluir B/L',
            message: 'Excluir 2 B/L(s)?',
            affected: {
              summary: '2 B/L(s) serão excluído(s).',
              items: ['BL1', 'BL2'],
              blocked: [{ label: 'BL3', reasons: ['vinculado a fatura'] }],
            },
            consequence: 'Os B/Ls saem das listas.',
            reversibility: 'Não é possível desfazer.',
            confirmLabel: 'Excluir',
            tone: 'danger',
          })
          setResult(reason === null ? 'voltou' : `motivo:${reason}`)
        }}
      >
        abrir
      </button>
      <output>{result}</output>
    </>
  )
}

function renderHarness() {
  render(
    <ConfirmDialogProvider>
      <Harness />
    </ConfirmDialogProvider>,
  )
}

describe('ConfirmDialog com motivo', () => {
  it('mostra afetados, bloqueados, consequência e reversibilidade; a lista abre sob demanda', async () => {
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'abrir' }))

    expect(screen.getByText('2 B/L(s) serão excluído(s).')).toBeTruthy()
    expect(screen.getByText('BL3')).toBeTruthy()
    expect(screen.getByText('vinculado a fatura')).toBeTruthy()
    expect(screen.getByText('Os B/Ls saem das listas.')).toBeTruthy()
    expect(screen.getByText('Não é possível desfazer.')).toBeTruthy()
    expect(screen.queryByText('BL1')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Ver lista (2)' }))
    expect(screen.getByText('BL1')).toBeTruthy()
  })

  it('só executa com motivo preenchido e devolve o motivo', async () => {
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'abrir' }))

    const excluir = screen.getByRole('button', { name: 'Excluir' }) as HTMLButtonElement
    expect(excluir.disabled).toBe(true)
    // Com motivo obrigatório, o foco já começa no campo de motivo.
    expect(document.activeElement).toBe(screen.getByLabelText('Motivo (obrigatório)'))
    await user.type(screen.getByLabelText('Motivo (obrigatório)'), '  cadastro duplicado ')
    expect(excluir.disabled).toBe(false)
    await user.click(excluir)

    expect(screen.getByText('motivo:cadastro duplicado')).toBeTruthy()
  })

  it('Voltar fecha sem executar', async () => {
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'abrir' }))
    await user.click(screen.getByRole('button', { name: 'Voltar' }))

    expect(screen.getByText('voltou')).toBeTruthy()
  })
})

describe('ConfirmDialog — diálogo substituído', () => {
  it('o diálogo anterior encerra como Voltar quando outro é aberto', async () => {
    const { fireEvent } = await import('@testing-library/react')
    render(<ConfirmDialogProvider><Harness /></ConfirmDialogProvider>)
    const open = screen.getByRole('button', { name: 'abrir' })
    fireEvent.click(open)
    fireEvent.click(open)
    expect(await screen.findByText('voltou')).toBeTruthy()
  })
})

// Lote grande: a lista de afetados ganha filtro e os bloqueados aparecem
// agrupados por motivo, com a lista completa só sob demanda.
function BigHarness() {
  const confirmWithReason = useConfirmWithReason()
  return (
    <button
      type="button"
      onClick={() => void confirmWithReason({
        title: 'Excluir B/L',
        message: 'Excluir 300 B/L(s)?',
        affected: {
          summary: '300 B/L(s) serão excluído(s).',
          items: Array.from({ length: 300 }, (_, i) => `BL${String(i).padStart(3, '0')}`),
          blocked: Array.from({ length: 8 }, (_, i) => ({
            label: `BLQ${i}`,
            reasons: [i < 5 ? 'vinculado a fatura' : 'CE Mercante informado'],
          })),
        },
        confirmLabel: 'Excluir',
        tone: 'danger',
      })}
    >
      abrir
    </button>
  )
}

describe('ConfirmDialog — lote grande', () => {
  it('filtra a lista de afetados e resume bloqueados por motivo', async () => {
    const user = userEvent.setup()
    render(<ConfirmDialogProvider><BigHarness /></ConfirmDialogProvider>)
    await user.click(screen.getByRole('button', { name: 'abrir' }))

    const counts = screen.getByRole('list', { name: 'Motivos dos bloqueios' })
    expect(counts.textContent).toContain('vinculado a fatura5')
    expect(counts.textContent).toContain('CE Mercante informado3')
    expect(screen.queryByText('BLQ0')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Ver lista (300)' }))
    expect(screen.getByText('BL299')).toBeTruthy()
    await user.type(screen.getByLabelText('Filtrar registros'), 'BL29')
    expect(screen.getByText('10 de 300')).toBeTruthy()
    expect(screen.queryByText('BL000')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Ver bloqueados (8)' }))
    expect(screen.getByText('BLQ0')).toBeTruthy()
  })
})
