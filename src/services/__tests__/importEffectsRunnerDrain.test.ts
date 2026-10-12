import { describe, expect, it } from 'vitest'
import {
  drainImportEffects,
  type Rpc,
} from '../../../supabase/functions/import-effects-runner/drain.ts'

// Migration 218: o runner trabalha por orçamento de tempo, em blocos pequenos,
// um runner por vez, em vez de um lote fixo de 20 a cada 5 minutos.

function fakeQueue(total: number, secondsPerEffect: number, leaseAnswers: boolean[] = []) {
  let clock = 0
  let next = 1
  const calls: string[] = []
  const claims: number[] = []
  const rpc: Rpc = async (name, args) => {
    calls.push(name)
    if (name === 'acquire_import_effects_runner') return { data: leaseAnswers.shift() ?? true, error: null }
    if (name === 'release_import_effects_runner') return { data: null, error: null }
    if (name === 'claim_import_effects') {
      const limit = Number(args.p_limit)
      const ids: Array<{ id: number }> = []
      while (ids.length < limit && next <= total) ids.push({ id: next++ })
      claims.push(ids.length)
      return { data: ids, error: null }
    }
    clock += secondsPerEffect * 1000
    return { data: { effect: { status: 'succeeded' } }, error: null }
  }
  return { rpc, calls, claims, now: () => clock }
}

describe('drainImportEffects', () => {
  it('com efeitos rápidos, segue pedindo blocos até esvaziar a fila e devolve a vez', async () => {
    const queue = fakeQueue(95, 0.07)
    const result = await drainImportEffects(queue.rpc, 'w', { now: queue.now })
    expect(result).toMatchObject({ ok: true, claimed: 95 })
    // 9 blocos cheios e o último incompleto encerra sem novo claim.
    expect(queue.claims).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 10, 5])
    expect(queue.calls.at(-1)).toBe('release_import_effects_runner')
  })

  it('com efeitos lentos, para de pedir blocos quando o orçamento acaba', async () => {
    const queue = fakeQueue(1000, 2)
    const result = await drainImportEffects(queue.rpc, 'w', { now: queue.now })
    // 25 s de orçamento com 2 s por efeito: o 2º bloco termina em 40 s e
    // nenhum terceiro é pedido; os 980 restantes ficam para o próximo ciclo.
    expect(result).toMatchObject({ ok: true, claimed: 20 })
    expect(queue.claims).toEqual([10, 10])
  })

  it('com outro runner trabalhando, sai sem pedir efeito nem devolver a vez alheia', async () => {
    const queue = fakeQueue(50, 0.07, [false])
    const result = await drainImportEffects(queue.rpc, 'w', { now: queue.now })
    expect(result).toEqual({ ok: true, skipped: 'busy' })
    expect(queue.calls).toEqual(['acquire_import_effects_runner'])
  })

  it('ao perder a vez entre blocos, para de pedir efeitos', async () => {
    const queue = fakeQueue(50, 0.07, [true, true, false])
    const result = await drainImportEffects(queue.rpc, 'w', { now: queue.now })
    expect(result).toMatchObject({ ok: true, claimed: 20 })
    expect(queue.claims).toEqual([10, 10])
  })

  it('erro no primeiro claim é falha; erro depois preserva o que foi feito; a vez sempre volta', async () => {
    const released: string[] = []
    const failing: Rpc = async (name) => {
      if (name === 'acquire_import_effects_runner') return { data: true, error: null }
      if (name === 'release_import_effects_runner') {
        released.push('first')
        return { data: null, error: null }
      }
      return { data: null, error: { message: 'x' } }
    }
    expect(await drainImportEffects(failing, 'w', { now: () => 0 })).toEqual({ ok: false, error: 'claim_failed' })
    expect(released).toEqual(['first'])

    let claims = 0
    const failsSecond: Rpc = async (name) => {
      if (name === 'acquire_import_effects_runner') return { data: true, error: null }
      if (name === 'release_import_effects_runner') return { data: null, error: null }
      if (name !== 'claim_import_effects') return { data: { effect: { status: 'succeeded' } }, error: null }
      claims += 1
      return claims === 1
        ? { data: Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })), error: null }
        : { data: null, error: { message: 'x' } }
    }
    expect(await drainImportEffects(failsSecond, 'w', { now: () => 0 })).toMatchObject({ ok: true, claimed: 10 })
  })

  it('erro ao pedir a vez é falha, sem pedir efeito', async () => {
    const calls: string[] = []
    const rpc: Rpc = async (name) => {
      calls.push(name)
      return { data: null, error: { message: 'x' } }
    }
    expect(await drainImportEffects(rpc, 'w', { now: () => 0 })).toEqual({ ok: false, error: 'lease_failed' })
    expect(calls).toEqual(['acquire_import_effects_runner'])
  })
})
