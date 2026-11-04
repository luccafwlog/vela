import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('../supabase', () => ({ supabase: { rpc: (name: string, args: unknown) => rpc(name, args) } }))

import {
  escalaSemTerminalKey,
  fetchEscalasSemTerminal,
  operationFrontPendingLabel,
  pendingFrontsForDirection,
  pendingFrontsTitle,
} from '../escalaTerminalPendente'
import { withPendingTerminal } from '../lineup'

// Revisão de 2026-11-04 (D5): a tela lê as frentes sem terminal pela mesma
// derivação do banco que trava o Fechar ADR (migration 583).
describe('frentes sem terminal por escala', () => {
  beforeEach(() => rpc.mockReset())

  it('chaveia por Viagem e porto normalizado e ignora escala sem frente', async () => {
    rpc.mockResolvedValueOnce({
      data: [
        { voyage_id: 169, port: 'BRVIX', fronts: ['importacao:vazio', 'importacao:carga_solta'] },
        { voyage_id: '170', port: 'BRSSZ', fronts: [] },
      ],
      error: null,
    })
    const result = await fetchEscalasSemTerminal([169, 170, 169])

    expect(rpc).toHaveBeenCalledWith('escala_frentes_sem_terminal', { p_voyage_ids: [169, 170] })
    expect(result.get(escalaSemTerminalKey(169, 'BRVIT'))).toEqual(['importacao:carga_solta', 'importacao:vazio'])
    expect(result.has(escalaSemTerminalKey(170, 'BRSSZ'))).toBe(false)
  })

  it('não consulta sem Viagem e propaga a recusa do banco', async () => {
    await expect(fetchEscalasSemTerminal([])).resolves.toEqual(new Map())
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })
    await expect(fetchEscalasSemTerminal([1])).rejects.toMatchObject({ message: 'permission denied' })
  })

  it('separa por sentido e usa os nomes da recusa do Fechar ADR', () => {
    const fronts = ['exportacao:granito', 'importacao:carga_solta', 'importacao:vazio']
    expect(pendingFrontsForDirection(fronts, 'importacao')).toEqual(['importacao:carga_solta', 'importacao:vazio'])
    expect(pendingFrontsForDirection(fronts, 'exportacao')).toEqual(['exportacao:granito'])
    expect(operationFrontPendingLabel('exportacao:vazio')).toBe('embarque de vazios')
    expect(pendingFrontsTitle(['importacao:carga_solta', 'importacao:vazio']))
      .toBe('Sem terminal: carga solta, vazios de importação. Atribua o terminal em Editar escala.')
  })

  it('o terminal da linha leva TBC uma vez quando há frente pendente', () => {
    expect(withPendingTerminal('TVV', ['importacao:carga_solta'])).toBe('TVV / TBC')
    expect(withPendingTerminal('TVV / TBC', ['importacao:carga_solta'])).toBe('TVV / TBC')
    expect(withPendingTerminal('TBC', ['importacao:carga_cheia'])).toBe('TBC')
    expect(withPendingTerminal('TVV', [])).toBe('TVV')
  })
})
