import type { EdgeTelemetryContext } from '../../../src/lib/telemetryContract.ts'

const DETECTOR_NAME_RE = /^[a-z_][a-z0-9_]*$/
const SQLSTATE_RE = /^[0-9A-Z]{5}$/

/**
 * Contexto do Sentry de cada detector que falhou numa rodada parcial de
 * `run_alert_detectors` (migration 351). Um evento por detector: o status leva
 * o nome, e o fingerprint por função e status (`telemetryScope.ts`) separa os
 * issues, para a falha nova de um detector não sumir dentro do issue de outro.
 * Vai o SQLSTATE, nunca a mensagem do banco, que pode ecoar dado de Cliente; a
 * mensagem fica no corpo da resposta e no WARNING do banco.
 */
export function alertDetectorFailureContexts(result: unknown): EdgeTelemetryContext[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return []
  const failures = (result as Record<string, unknown>).failures
  if (!Array.isArray(failures)) return []
  return failures.flatMap((failure): EdgeTelemetryContext[] => {
    if (!failure || typeof failure !== 'object') return []
    const { detector, sqlstate } = failure as Record<string, unknown>
    if (typeof detector !== 'string' || !DETECTOR_NAME_RE.test(detector)) return []
    return [{
      functionName: 'alerts-detector',
      status: `detector_failed:${detector}`,
      category: 'detector_failed',
      result: 'partial',
      failedRpc: 'run_alert_detectors',
      ...(typeof sqlstate === 'string' && SQLSTATE_RE.test(sqlstate) ? { errorCode: sqlstate } : {}),
    }]
  })
}
