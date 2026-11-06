// Rotinas automáticas do Vela (`pg_cron`) como a aba Sistema mostra: o nome em
// português e quando rodam, em horário de Brasília. A rotina sem nome aqui
// aparece pelo nome técnico, com "Rotina" na frente, para a conta Dev achá-la.

const ROUTINE_LABELS: Readonly<Record<string, string>> = {
  'alerts-foundation-detectors': 'Conferência dos alertas',
  'billing-release-expiry-review': 'Liberações de faturamento vencidas',
  'ce-unlock-cleanup': 'Limpeza dos documentos do Desbloqueio de CE',
  'ce-unlock-notify-email': 'Avisos por e-mail do Desbloqueio de CE',
  'cleanup-cron-run-details': 'Limpeza do registro das rotinas',
  'cleanup-provision-rate-limit': 'Limpeza do limite de tentativas do Portal',
  'container-demurrage-status': 'Situação de Demurrage dos containers',
  'customer-communication-auto-runner': 'Envio dos Comunicados automáticos',
  'data-retention': 'Limpeza de dados antigos',
  'demurrage-disputa-prazo': 'Prazo das disputas de Demurrage',
  'demurrage-dunning': 'Régua de cobrança da Demurrage',
  'demurrage-travado-alerts': 'Alertas de Demurrage travada',
  'http-job-failures': 'Conferência das chamadas às funções',
  'import-effects-queue-health': 'Conferência da fila da importação',
  'import-effects-runner': 'Passos depois da importação',
  'itau-pix-checkpoint-health': 'Conferência da leitura do Pix Itaú',
  'itau-pix-queue': 'Leitura do Pix Itaú',
  'portal-daily-digest': 'Resumo diário do Portal',
  'portal-email-events-runner': 'Retorno dos e-mails (entrega e devolução)',
  'portal-mark-expired-invites': 'Convites do Portal vencidos',
  'recalc-demurrage-ptax': 'PTAX da Demurrage',
}

export function routineLabel(jobname: string): string {
  return ROUTINE_LABELS[jobname] ?? `Rotina ${jobname}`
}

const BRASILIA_OFFSET_HOURS = -3

/**
 * Quando a rotina roda, em português e em horário de Brasília. O `pg_cron` do
 * Supabase usa UTC.
 * ponytail: entende os formatos usados hoje (minuto, intervalo de minutos, hora
 * fixa, dias úteis); outro formato aparece como "horário próprio". Rotina diária
 * antes das 3h UTC em dias úteis mudaria de dia na conversão e não é tratada.
 */
export function describeCronSchedule(schedule: string): string {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return 'horário próprio'
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  if (dayOfMonth !== '*' || month !== '*') return 'horário próprio'
  if (hour === '*' && dayOfWeek === '*') {
    if (minute === '*') return 'a cada minuto'
    const every = /^(?:\*|\d+-59)\/(\d+)$/.exec(minute)
    if (every) return `a cada ${every[1]} min`
    if (/^\d+$/.test(minute)) return 'de hora em hora'
    return 'horário próprio'
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    const local = (Number(hour) + BRASILIA_OFFSET_HOURS + 24) % 24
    const time = `${String(local).padStart(2, '0')}:${minute.padStart(2, '0')}`
    if (dayOfWeek === '*') return `todo dia ${time}`
    if (dayOfWeek === '1-5') return `dias úteis ${time}`
  }
  return 'horário próprio'
}
