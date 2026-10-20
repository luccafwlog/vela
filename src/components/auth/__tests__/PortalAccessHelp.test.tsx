// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PortalAccessHelp } from '../PortalAccessHelp'

afterEach(cleanup)

// suporte@fwlog.com.br não existe; o suporte do Portal é o mesmo endereço dos e-mails de acesso.
it('"Fale com o suporte" leva ao endereço de suporte do Portal', () => {
  render(<PortalAccessHelp />)
  expect(screen.getByRole('link', { name: 'Fale com o suporte' }).getAttribute('href')).toBe('mailto:suporte@portalfwlog.com.br')
})
