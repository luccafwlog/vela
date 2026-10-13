// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Block, Fact, FactList, LeadValue } from '../Block'
import { Button } from '../Button'
import { IdentityBand } from '../IdentityBand'
import { NextAction } from '../NextAction'
import { NoValue } from '../NoValue'

afterEach(cleanup)

describe('peças da identidade visual (ADR 0081)', () => {
  it('Block nomeia a seção pelo título da faixa e mantém o apoio à direita', () => {
    render(
      <Block title="Carga" aside={<Button variant="secondary">Ver na aba Carga</Button>}>
        <LeadValue detail="2 contêineres 40HC" tone="warning">0 de 2 devolvidos</LeadValue>
        <FactList>
          <Fact label="Baplie">Não importado</Fact>
        </FactList>
      </Block>,
    )
    const region = screen.getByRole('region', { name: 'Carga' })
    expect(within(region).getByRole('heading', { level: 2, name: 'Carga' })).toBeTruthy()
    expect(within(region).getByRole('button', { name: 'Ver na aba Carga' })).toBeTruthy()
    expect(within(region).getByText('0 de 2 devolvidos').className).toContain('app-lead__value--warning')
    expect(within(region).getByRole('term').textContent).toBe('Baplie')
    expect(within(region).getByRole('definition').textContent).toBe('Não importado')
  })

  it('Block com flush entrega o conteúdo sem o recuo do corpo, para tabela', () => {
    const { container } = render(<Block title="Contêineres" flush headingLevel={3}><table /></Block>)
    expect(container.querySelector('.app-block__flush > table')).toBeTruthy()
    expect(container.querySelector('.app-block__body')).toBeNull()
    expect(screen.getByRole('heading', { level: 3, name: 'Contêineres' })).toBeTruthy()
  })

  it('NoValue mostra o traço e diz o significado ao leitor de tela', () => {
    render(<p>Devolução: <NoValue label="Sem data de devolução" /></p>)
    expect(screen.getByText('—').getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('Sem data de devolução').className).toContain('sr-only')
  })

  it('IdentityBand dá o título da página e os fatos que situam o registro', () => {
    render(
      <IdentityBand
        kind="B/L de contêiner"
        title="COSU6401234501"
        facts={[{ label: 'Trecho', value: 'CNSHA → BRSSZ' }, { label: 'CE Mercante', value: '152605123456701' }]}
        actions={<Button variant="secondary">Reimportar B/L</Button>}
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'COSU6401234501' })).toBeTruthy()
    expect(screen.getAllByRole('term').map((node) => node.textContent)).toEqual(['Trecho', 'CE Mercante'])
    expect(screen.getByRole('button', { name: 'Reimportar B/L' })).toBeTruthy()
  })

  it('NextAction é uma região própria com o motivo em texto e o botão para resolver', () => {
    render(
      <NextAction action={<Button variant="secondary">Resolver na Revisão</Button>}>
        Cliente: a conta do Portal não está ativa nem provisionada.
      </NextAction>,
    )
    const region = screen.getByRole('region', { name: 'Próxima ação' })
    expect(region.className).toContain('app-next-action--danger')
    expect(within(region).getByText(/conta do Portal não está ativa/)).toBeTruthy()
    expect(within(region).getByRole('button', { name: 'Resolver na Revisão' })).toBeTruthy()
  })
})
