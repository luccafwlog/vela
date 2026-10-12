// Laço do import-effects-runner com orçamento de tempo (migration 218).
//
// Um efeito leva de ~0,07 s a ~9 s (medido em produção, 2026-10-12): lote fixo
// ou desperdiça o ciclo ou passa da lease. Aqui, novos blocos só são pedidos
// dentro do orçamento; o bloco reservado é sempre processado inteiro, e o
// tamanho pequeno limita quanto o ciclo passa do orçamento.
//
// Um runner por vez: a vez (`acquire_import_effects_runner`) é renovada antes
// de cada bloco; a chamada que não a obtém sai sem processar, e a que perde a
// vez para de pedir blocos. Sem isso, o job por minuto e o disparo de cada
// importação rodavam juntos e efeitos da mesma Viagem disputavam travas.
// ponytail: processamento sequencial e um runner por vez. Teto: ~25 s de
// trabalho por chamada. Caminho de upgrade: vez por Viagem, runners paralelos.

export const CLAIM_CHUNK = 10
// Abaixo dos 30 s do pg_net no caso comum (a resposta chega ao cron); um bloco
// lento pode passar disso, mas não da lease de 300 s, então nenhum efeito é
// recuperado por outro runner enquanto ainda roda.
export const BUDGET_MS = 25_000
export const LEASE_SECONDS = 300
// Acima do pior bloco medido (10 efeitos de ~9 s); se o runner morrer, vence.
export const RUNNER_LEASE_SECONDS = 120

export type RpcResult = { data: unknown; error: unknown }
export type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>

type Outcome = { effect_id: number; status: string }

export type DrainResult =
  | { ok: false; error: 'claim_failed' | 'lease_failed' }
  | { ok: true; skipped: 'busy' }
  | { ok: true; claimed: number; outcomes: Outcome[] }

async function acquireRunnerLease(rpc: Rpc, workerId: string): Promise<boolean | 'error'> {
  const { data, error } = await rpc('acquire_import_effects_runner', {
    p_worker_id: workerId,
    p_lease_seconds: RUNNER_LEASE_SECONDS,
  })
  if (error) {
    console.error('import-effects-runner: vez do runner falhou', error)
    return 'error'
  }
  return data === true
}

async function processChunk(rpc: Rpc, workerId: string, effects: unknown[], outcomes: Outcome[]) {
  for (const effect of effects) {
    const effectId = Number((effect as { id?: unknown }).id)
    if (!Number.isSafeInteger(effectId) || effectId <= 0) {
      console.error('import-effects-runner: claim retornou id inválido')
      continue
    }

    const { data: processResult, error: processError } = await rpc('process_import_effect', {
      p_effect_id: effectId,
      p_worker_id: workerId,
    })
    if (processError) {
      // Em erro de rede o lease expira e outro ciclo recupera o efeito. O
      // payload não é repetido no log para não vazar snapshot de importação.
      console.error('import-effects-runner: processamento falhou', { effectId, error: processError })
      outcomes.push({ effect_id: effectId, status: 'completed_with_error' })
      continue
    }
    const processedStatus = (processResult as { effect?: { status?: unknown } } | null)?.effect?.status
    outcomes.push({ effect_id: effectId, status: typeof processedStatus === 'string' ? processedStatus : 'completed' })
  }
}

export async function drainImportEffects(
  rpc: Rpc,
  workerId: string,
  options: { budgetMs?: number; chunk?: number; now?: () => number } = {},
): Promise<DrainResult> {
  const budgetMs = options.budgetMs ?? BUDGET_MS
  const chunk = options.chunk ?? CLAIM_CHUNK
  const now = options.now ?? Date.now
  const startedAt = now()

  const lease = await acquireRunnerLease(rpc, workerId)
  if (lease === 'error') return { ok: false, error: 'lease_failed' }
  if (!lease) return { ok: true, skipped: 'busy' }

  let claimedTotal = 0
  let claimFailed = false
  const outcomes: Outcome[] = []
  try {
    for (let round = 0; now() - startedAt < budgetMs; round += 1) {
      // A vez já foi obtida para o primeiro bloco; os seguintes a renovam.
      if (round > 0 && (await acquireRunnerLease(rpc, workerId)) !== true) break

      const { data: claimed, error: claimError } = await rpc('claim_import_effects', {
        p_worker_id: workerId,
        p_limit: chunk,
        p_lease_seconds: LEASE_SECONDS,
      })
      if (claimError) {
        console.error('import-effects-runner: claim falhou', claimError)
        claimFailed = true
        break
      }

      const effects = Array.isArray(claimed) ? claimed : []
      claimedTotal += effects.length
      await processChunk(rpc, workerId, effects, outcomes)
      // Bloco incompleto: a fila (do que está vencido) esvaziou.
      if (effects.length < chunk) break
    }
  } finally {
    const { error } = await rpc('release_import_effects_runner', { p_worker_id: workerId })
    // Sem a devolução, a vez vence sozinha em RUNNER_LEASE_SECONDS.
    if (error) console.error('import-effects-runner: devolução da vez falhou', error)
  }

  // Os efeitos já processados ficam; só um ciclo que nada fez é erro.
  if (claimFailed && claimedTotal === 0) return { ok: false, error: 'claim_failed' }
  return { ok: true, claimed: claimedTotal, outcomes }
}
