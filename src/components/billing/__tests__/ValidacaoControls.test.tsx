// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ValidacaoControls } from '../ValidacaoControls'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

afterEach(cleanup)
function renderControls(overrides: Partial<React.ComponentProps<typeof ValidacaoControls>> = {}) {
  const callbacks = { onUpdateFilter: vi.fn(), onRunBatchOperation: vi.fn(), onExport: vi.fn(), onExportConference: vi.fn() }
  render(<QueryClientProvider client={new QueryClient()}><ValidacaoControls filters={{ search: '', cargoMode: '', pod: '', voyageId: '', blockCode: '', includeResolved: false }} blockedCount={0} truncated={false} selectedCount={0} operationsLoading={false} calculatePending={false} exporting={false} exportingConference={false} {...callbacks} {...overrides} /></QueryClientProvider>)
  return callbacks
}

describe('ValidacaoControls', () => {
  it('desabilita recalculo sem seleção', () => { renderControls(); expect((screen.getByRole('button', { name: /Recalcular/ }) as HTMLButtonElement).disabled).toBe(true) })
  it('mostra contador e aviso no teto', () => { renderControls({ blockedCount: 100, truncated: true, selectedCount: 3 }); expect(screen.getByText('100 B/Ls aguardando emissão · 3 selecionados')).toBeTruthy(); expect(screen.getByText(/Limite de 1200/)).toBeTruthy() })
  it('executa recalculo quando há seleção', async () => { const user = userEvent.setup(); const callbacks = renderControls({ blockedCount: 2, selectedCount: 1 }); await user.click(screen.getByRole('button', { name: /Recalcular/ })); expect(callbacks.onRunBatchOperation).toHaveBeenCalledWith('recalculate') })
})
