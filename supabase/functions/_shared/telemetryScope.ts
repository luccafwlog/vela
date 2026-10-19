import { scrubTelemetryText, type EdgeTelemetryContext } from '../../../src/lib/telemetryContract.ts'

/** Parte do escopo do Sentry usada pelas Edge Functions; sem import do SDK para ser testável. */
export type EdgeTelemetryScope = {
  setTag: (key: string, value: string) => unknown
  setFingerprint: (fingerprint: string[]) => unknown
}

/**
 * Marca o evento de uma Edge Function. O fingerprint agrupa por função e
 * status (plano de correção dos e-mails, 2.2): sem ele, todo erro vira a
 * mesma mensagem genérica "Edge Function execution failed" e o Sentry junta
 * falhas de funções diferentes num só issue.
 */
export function applyEdgeTelemetryScope(scope: EdgeTelemetryScope, context: EdgeTelemetryContext): void {
  scope.setTag('surface', context.surface ?? 'edge')
  scope.setTag('function_name', context.functionName)
  if (context.jobName) scope.setTag('job_name', context.jobName)
  if (context.category) scope.setTag('categoria_falha', scrubTelemetryText(context.category))
  if (context.status) scope.setTag('status', context.status)
  if (context.result) scope.setTag('result', context.result)
  if (Number.isFinite(context.durationMs)) scope.setTag('duration_ms', String(context.durationMs))
  if (Number.isFinite(context.processedCount)) scope.setTag('processed_count', String(context.processedCount))
  scope.setFingerprint(['edge', context.functionName, context.status ?? 'unknown'])
}
