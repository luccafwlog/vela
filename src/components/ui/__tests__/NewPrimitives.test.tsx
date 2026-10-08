// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MetricCard } from '../MetricCard'
import { SegmentedControl } from '../SegmentedControl'
import { StepRail } from '../StepRail'
import { SummaryStrip } from '../SummaryStrip'
import { TabButton } from '../TabButton'
import { TabList } from '../TabList'

afterEach(cleanup)

describe('SegmentedControl', () => {
  function Harness({ onChange = vi.fn() }: { onChange?: (value: string) => void }) {
    const [value, setValue] = useState<'item' | 'outra'>('item')
    return (
      <SegmentedControl
        label="Origem da cobrança"
        value={value}
        onChange={(next) => { setValue(next); onChange(next) }}
        options={[{ value: 'item', label: 'Item da tabela' }, { value: 'outra', label: 'Outra' }]}
      />
    )
  }

  it('expõe um grupo de rádio com uma única parada de Tab na opção marcada', () => {
    render(<Harness />)
    expect(screen.getByRole('radiogroup', { name: 'Origem da cobrança' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Item da tabela' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Item da tabela' }).tabIndex).toBe(0)
    expect(screen.getByRole('radio', { name: 'Outra' }).tabIndex).toBe(-1)
  })

  it('troca a escolha pelas setas e leva o foco junto', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    screen.getByRole('radio', { name: 'Item da tabela' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('outra')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Outra' }))
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('item')
  })
})

describe('TabList', () => {
  function Harness() {
    const [tab, setTab] = useState('faturas')
    return (
      <TabList label="Módulos de faturamento">
        <TabButton active={tab === 'faturas'} label="Faturas" onClick={() => setTab('faturas')} />
        <TabButton active={tab === 'validacao'} label="Validação" count={3} countLabel="3 pendências" onClick={() => setTab('validacao')} />
      </TabList>
    )
  }

  it('move e ativa a aba pelas setas, Home e End', async () => {
    render(<Harness />)
    screen.getByRole('tab', { name: 'Faturas' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    const validacao = screen.getByRole('tab', { name: 'Validação, 3 pendências' })
    expect(document.activeElement).toBe(validacao)
    expect(validacao.getAttribute('aria-selected')).toBe('true')
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Faturas' }).getAttribute('aria-selected')).toBe('true')
    await userEvent.keyboard('{End}')
    expect(validacao.getAttribute('aria-selected')).toBe('true')
  })

  it('deixa só a aba ativa na ordem do Tab', async () => {
    render(
      <>
        <Harness />
        <button type="button">Depois das abas</button>
      </>,
    )
    expect(screen.getByRole('tab', { name: 'Faturas' }).tabIndex).toBe(0)
    expect(screen.getByRole('tab', { name: 'Validação, 3 pendências' }).tabIndex).toBe(-1)
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Faturas' }))
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Depois das abas' }))
  })
})

describe('StepRail', () => {
  it('lê o estado de cada etapa em texto e marca a etapa atual', () => {
    render(
      <MemoryRouter>
        <StepRail
          label="Ciclo da fatura"
          steps={[
            { key: 'emitida', label: 'Emitida', detail: '01/10/2026', state: 'done' },
            { key: 'paga', label: 'Paga', detail: 'Vence 15/10/2026', state: 'current', href: '/portal/billing' },
          ]}
        />
      </MemoryRouter>,
    )
    const rail = screen.getByRole('list', { name: 'Ciclo da fatura' })
    const items = rail.querySelectorAll('li')
    expect(items[0].textContent).toContain('Concluída')
    expect(items[1].getAttribute('aria-current')).toBe('step')
    expect(screen.getByRole('link', { name: /Paga.*Em andamento/ }).getAttribute('href')).toBe('/portal/billing')
  })

  it('lê o desvio em texto, não só pela forma do ponto', () => {
    render(
      <MemoryRouter>
        <StepRail label="Rota" steps={[{ key: 'vix', label: 'Vitória', detail: 'Omitida', state: 'diverted' }]} />
      </MemoryRouter>,
    )
    const item = screen.getByRole('list', { name: 'Rota' }).querySelector('li')
    expect(item?.textContent).toContain('Desvio')
    expect(item?.classList.contains('app-step-rail__step--diverted')).toBe(true)
  })
})

describe('SummaryStrip e MetricCard', () => {
  it('resume números como pares termo/valor', () => {
    render(<SummaryStrip items={[{ label: 'B/Ls', value: 12 }, { label: 'CNTRs', value: 16 }]} />)
    const terms = screen.getAllByRole('term').map((node) => node.textContent)
    expect(terms).toEqual(['B/Ls', 'CNTRs'])
    expect(screen.getAllByRole('definition').map((node) => node.textContent)).toEqual(['12', '16'])
  })

  it('vira botão de filtro quando recebe onSelect', async () => {
    const onSelect = vi.fn()
    render(<MetricCard label="Vencidas" value={2} onSelect={onSelect} selected />)
    const button = screen.getByRole('button', { name: /Vencidas/ })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(button)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
