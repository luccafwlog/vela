// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { EditarAcessoModal } from '../EditarAcessoModal'

afterEach(cleanup)

function renderModal(currentRole: 'operator' | 'documentacao') {
  const onSubmit = vi.fn()
  render(<EditarAcessoModal open userName="Joana" currentEmail="joana@fwlog.com.br" currentRole={currentRole} onClose={vi.fn()} onSubmit={onSubmit} submitting={false} />)
  return onSubmit
}

// ACE-D13 de 2026-10-27: o Administrativo passa o setor antigo Operador para
// Documentação pela tela, sem código.
it('setor antigo Operador: salvar sem trocar a escolha grava Documentação', async () => {
  const onSubmit = renderModal('operator')
  expect(screen.getByText('Setor antigo Operador, que vale como Documentação. Salvar grava o setor escolhido.')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  expect(onSubmit).toHaveBeenCalledWith({ email: undefined, password: undefined, role: 'documentacao' })
})

it('Documentação gravada: salvar sem mudança pede o que trocar', async () => {
  const onSubmit = renderModal('documentacao')
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  expect(onSubmit).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toBe('Troque o setor, o e-mail ou a senha.')
})

// ADR 0104 (revisão da PR #1070): a conta Dev de outra pessoa tem e-mail e
// senha travados; a própria pessoa troca os dela.
it('conta com a marca Dev de outra pessoa: e-mail e senha travados, com o motivo', () => {
  render(<EditarAcessoModal open userName="Lucca" currentEmail="dev@fwlog.com.br" currentRole="documentacao" devAccount onClose={vi.fn()} onSubmit={vi.fn()} submitting={false} />)
  expect((screen.getByLabelText(/E-mail de login/) as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByLabelText('Nova senha') as HTMLInputElement).disabled).toBe(true)
  expect(screen.getByText(/só são trocados pela própria pessoa/)).toBeTruthy()
})

it('a própria conta Dev continua com e-mail e senha liberados', () => {
  render(<EditarAcessoModal open userName="Lucca" currentEmail="dev@fwlog.com.br" currentRole="documentacao" devAccount isSelf onClose={vi.fn()} onSubmit={vi.fn()} submitting={false} />)
  expect((screen.getByLabelText(/E-mail de login/) as HTMLInputElement).disabled).toBe(false)
})
