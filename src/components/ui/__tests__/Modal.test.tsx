// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { Modal } from '../Modal'

afterEach(cleanup)

it('inclui foco adicionado depois da abertura no ciclo de Tab e restaura foco ao fechar', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()

  function Harness() {
    const [open, setOpen] = useState(false)
    const [extra, setExtra] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Abrir</button>
        <Modal open={open} title="Teste" onClose={() => { onClose(); setOpen(false) }}>
          <button type="button" onClick={() => setExtra(true)}>Adicionar</button>
          {extra ? <button type="button">Botao async</button> : null}
        </Modal>
      </>
    )
  }

  render(<Harness />)
  await user.click(screen.getByRole('button', { name: 'Abrir' }))
  await user.click(screen.getByRole('button', { name: 'Adicionar' }))
  screen.getByRole('button', { name: 'Botao async' }).focus()
  await user.tab()

  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fechar modal' }))

  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abrir' }))
})

it('leva o foco ao primeiro campo do formulário e ao título num modal de leitura', () => {
  const { rerender } = render(
    <Modal open title="Nova viagem" onClose={() => {}}>
      <label>Navio <input /></label>
      <button type="button">Salvar</button>
    </Modal>,
  )
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Navio' }))

  rerender(
    <Modal open={false} title="Nova viagem" onClose={() => {}}>
      <span />
    </Modal>,
  )
  rerender(
    <Modal open title="Detalhe da fatura" onClose={() => {}}>
      <p>Total R$ 10,00</p>
      <button type="button">Imprimir</button>
    </Modal>,
  )
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Detalhe da fatura' }))
})

it('aplica a largura pedida sem afetar o padrão largo', () => {
  render(
    <Modal open title="Confirmar" size="sm" onClose={() => {}}>
      <p>Texto</p>
    </Modal>,
  )
  expect(screen.getByRole('dialog').className).toContain('app-modal--sm')
})

it('mantém Shift+Tab dentro do modal quando o foco inicial está no título', async () => {
  const user = userEvent.setup()
  render(
    <>
      <button type="button">Fora do modal</button>
      <Modal open title="Detalhe da fatura" onClose={() => {}}>
        <p>Total R$ 10,00</p>
        <button type="button">Imprimir</button>
      </Modal>
    </>,
  )
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Detalhe da fatura' }))

  await user.tab({ shift: true })

  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Imprimir' }))
})
