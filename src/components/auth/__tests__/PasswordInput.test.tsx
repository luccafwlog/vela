// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Field } from '../../ui/Input'
import { PasswordInput } from '../PasswordInput'

it('mostra e oculta a senha sem perder o rótulo, a descrição e o valor', () => {
  render(
    <>
      <Field label="Senha atual" required>
        <PasswordInput aria-describedby="regra" defaultValue="segredo1A" />
      </Field>
      <p id="regra">Regra da senha</p>
    </>,
  )

  const input = screen.getByLabelText(/Senha atual/) as HTMLInputElement
  expect(input.type).toBe('password')
  expect(input.getAttribute('aria-describedby')).toBe('regra')
  expect(input.required).toBe(true)

  const toggle = screen.getByRole('button', { name: 'Mostrar senha' })
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(toggle)

  expect(input.type).toBe('text')
  expect(input.value).toBe('segredo1A')
  expect(screen.getByRole('button', { name: 'Ocultar senha' }).getAttribute('aria-pressed')).toBe('true')
})
