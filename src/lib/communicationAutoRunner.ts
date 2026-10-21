/**
 * Agenda do robô de Comunicados (`customer-communication-auto-runner`, cron
 * `4-59/15 * * * *`: minutos 4, 19, 34 e 49 de cada hora; agenda em
 * docs/operations/servicos-externos.md). O minuto é o mesmo em UTC e em
 * Brasília, então a próxima rodada sai só do relógio.
 * ponytail: espelho do cron em código; se a agenda mudar no Supabase, mude
 * aqui também (o teste prende os minutos).
 */
export const AUTO_RUNNER_MINUTES = [4, 19, 34, 49] as const

/** Próxima rodada estritamente depois de `now`. */
export function nextAutoRunnerRun(now: Date): Date {
  const next = new Date(now.getTime())
  next.setUTCSeconds(0, 0)
  const minute = now.getUTCMinutes()
  const upcoming = AUTO_RUNNER_MINUTES.find((value) => value > minute)
  if (upcoming === undefined) {
    next.setUTCHours(next.getUTCHours() + 1, AUTO_RUNNER_MINUTES[0])
  } else {
    next.setUTCMinutes(upcoming)
  }
  return next
}

/** "HH:MM" no fuso de Brasília. */
export function formatBrasiliaTime(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(value)
}

/** "Na fila · próxima rodada às HH:MM (BRT)". */
export function queuedLabel(now: Date): string {
  return `Na fila · próxima rodada às ${formatBrasiliaTime(nextAutoRunnerRun(now))} (BRT)`
}
