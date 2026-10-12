// Laço do import-effects-runner com orçamento de tempo (migration 218).
//
// Um efeito leva de ~0,07 s a ~9 s (medido em produção, 2026-10-12): lote fixo
// ou desperdiça o ciclo ou passa da lease. Aqui, novos blocos só são pedidos
// dentro do orçamento; o bloco reservado é sempre processado inteiro, e o
// tamanho pequeno limita quanto o ciclo passa do orçamento.
// ponytail: processamento sequencial. Teto: ~25 s de trabalho por chamada.
// Caminho de upgrade: runners paralelos separados por Viagem.

export const CLAIM_CHUNK = 10
// Abaixo dos 30 s do pg_net no caso comum (a resposta chega ao cron); um bloco
// lento pode passar disso, mas não da lease de 300 s, então nenhum efeito é
// recuperado por outro runner enquanto ainda roda.
export const BUDGET_MS = 25_000
export const LEASE_SECONDS = 300

export type RpcResult = { data: unknown; error: unknown }
export type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>

export type DrainResult =
  | { ok: false; error: 'claim_failed' }
  | { ok: true; claimed: number; outcomes: Array<{ effect_id: number; status: string }> }

export async function drainImportEffects(
  rpc: Rpc,
  workerId: string,
  options: { budgetMs?: number; chunk?: number; now?: () => number } = {},
): Promise<DrainResult> {
  const budgetMs = options.budgetMs ?? BUDGET_MS
  const chunk = options.chunk ?? CLAIM_CHUNK
  const now = options.now ?? Date.now
  const startedAt = now()
  let claimedTotal = 0
  const outcomes: Array<{ effect_id: number; status: string }> = []

  while (now() - startedAt < budgetMs) {
    const { data: claimed, error: claimError } = await rpc('claim_import_effects', {
      p_worker_id: workerId,
      p_limit: chunk,
      p_lease_seconds: LEASE_SECONDS,
    })
    if (claimError) {
      console.error('import-effects-runner: claim falhou', claimError)
      // Os efeitos já processados ficam; só um ciclo que nada fez é erro.
      if (claimedTotal === 0) return { ok: false, error: 'claim_failed' }
      break
    }

    const effects = Array.isArray(claimed) ? claimed : []
    claimedTotal += effects.length
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
    // Bloco incompleto: a fila (do que está vencido) esvaziou.
    if (effects.length < chunk) break
  }

  return { ok: true, claimed: claimedTotal, outcomes }
}
