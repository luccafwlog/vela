import { describe, expect, it } from 'vitest'
import {
  drainImportEffects,
  type Rpc,
} from '../../../supabase/functions/import-effects-runner/drain.ts'

// Migration 218: o runner trabalha por orçamento de tempo, em blocos pequenos,
// em vez de um lote fixo de 20 a cada 5 minutos.

function fakeQueue(total: number, secondsPerEffect: number) {
  let clock = 0
  let next = 1
  const claims: number[] = []
  const rpc: Rpc = async (name, args) => {
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
  return { rpc, claims, now: () => clock }
}

describe('drainImportEffects', () => {
  it('com efeitos rápidos, segue pedindo blocos até esvaziar a fila', async () => {
    const queue = fakeQueue(95, 0.07)
    const result = await drainImportEffects(queue.rpc, 'w', { now: queue.now })
    expect(result).toMatchObject({ ok: true, claimed: 95 })
    // 9 blocos cheios e o último incompleto encerra sem novo claim.
    expect(queue.claims).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 10, 5])
  })

  it('com efeitos lentos, para de pedir blocos quando o orçamento acaba', async () => {
    const queue = fakeQueue(1000, 2)
    const result = await drainImportEffects(queue.rpc, 'w', { now: queue.now })
    // 25 s de orçamento com 2 s por efeito: o 2º bloco termina em 40 s e
    // nenhum terceiro é pedido; os 980 restantes ficam para o próximo ciclo.
    expect(result).toMatchObject({ ok: true, claimed: 20 })
    expect(queue.claims).toEqual([10, 10])
  })

  it('erro no primeiro claim é falha; erro depois preserva o que foi feito', async () => {
    const failing: Rpc = async () => ({ data: null, error: { message: 'x' } })
    expect(await drainImportEffects(failing, 'w', { now: () => 0 })).toEqual({ ok: false, error: 'claim_failed' })

    let calls = 0
    const failsSecond: Rpc = async (name) => {
      if (name !== 'claim_import_effects') return { data: { effect: { status: 'succeeded' } }, error: null }
      calls += 1
      return calls === 1
        ? { data: Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })), error: null }
        : { data: null, error: { message: 'x' } }
    }
    const partial = await drainImportEffects(failsSecond, 'w', { now: () => 0 })
    expect(partial).toMatchObject({ ok: true, claimed: 10 })
  })
})
