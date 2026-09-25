import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const traceability = readFileSync(new URL('../../../docs/RASTREABILIDADE.md', import.meta.url), 'utf8')
const rows = traceability.split(/\r?\n/).filter((line) => line.startsWith('|'))

const contracts: Array<{
  label: string
  marker: string
  surface: string
  origin: string[]
  orchestration: string[]
  persistence: string[]
  evidence: string[]
}> = [
  {
    label: 'Conciliação PIX',
    marker: 'Persistir exceções PIX, ligar candidato e resolver pendência',
    surface: '/reconciliacao',
    origin: ['src/pages/Reconciliacao.tsx'],
    orchestration: ['queryKeys.reconciliation.pixExceptions()', 'src/services/reconciliacao.ts'],
    persistence: [
      'upsert_pix_reconciliation_exceptions',
      'resolve_pix_reconciliation_exception',
      'confirm_unified_pix_matches',
      'pix_reconciliation_exceptions',
    ],
    evidence: [
      'src/pages/__tests__/Reconciliacao.behavior.test.tsx',
      'src/services/__tests__/reconciliacao.test.ts',
      'src/services/__tests__/pixUnreconciledMigration.test.ts',
    ],
  },
  {
    label: 'Notificações do Portal',
    marker: 'Notificações do Portal — contar/listar/marcar como lidas',
    surface: '/portal/*',
    origin: ['src/components/portal/NotificationBell.tsx'],
    orchestration: ['usePortalNotifications', 'usePortalMarkRead', 'src/services/portalBilling.ts'],
    persistence: [
      'portal_notification_unread_count',
      'portal_list_notifications',
      'portal_mark_notification_read',
      'portal_mark_all_notifications_read',
      'portal_notifications',
    ],
    evidence: [
      'src/components/portal/__tests__/NotificationBell.behavior.test.tsx',
      'src/components/portal/__tests__/NotificationBell.test.tsx',
    ],
  },
  {
    label: 'Notificações internas',
    marker: 'Notificações internas — contar/listar/marcar e identificar entidade',
    surface: 'Shell interno',
    origin: ['src/components/layout/InternalNotificationBell.tsx'],
    orchestration: ['useInternalNotifications', 'useInternalNotificationEntityLabels', 'src/services/alerts.ts'],
    persistence: [
      'list_internal_notifications',
      'count_unread_internal_notifications',
      'mark_internal_notification_read',
      'mark_all_internal_notifications_read',
      'internal_notifications',
    ],
    evidence: [
      'src/components/layout/__tests__/InternalNotificationBell.test.tsx',
      'src/services/__tests__/internalNotifications.test.ts',
      'src/services/__tests__/internalNotificationsCursorMigration.test.ts',
    ],
  },
  {
    label: 'Vazios manuais',
    marker: 'Vazios — criar/editar/excluir unidade manualmente',
    surface: '/embarquevazios',
    origin: ['src/pages/EmbarqueVazios.tsx'],
    orchestration: ['React Query inline', 'src/services/vaziosExportOperations.ts'],
    persistence: [
      'create_manual_vazios_booking',
      'update_manual_vazios_booking',
      'delete_manual_vazios_booking',
      'vazios_bookings',
    ],
    evidence: [
      'src/pages/__tests__/EmbarqueVazios.flow.test.tsx',
      'src/services/__tests__/vaziosManualBooking.test.ts',
      'src/services/__tests__/vaziosManualBookingRpc.test.ts',
      'src/services/__tests__/vaziosManualBookingAtomicMigration.test.ts',
    ],
  },
  {
    label: 'Estatísticas de Vazios de Importação',
    marker: 'Viagens — resumir Vazios de Importação por rota/viagem',
    surface: '/viagens',
    origin: ['src/pages/Viagens.tsx', 'VoyageCard.tsx', 'VoyageImportacaoTab.tsx'],
    orchestration: ['useVaziosImportacaoStats', 'o próprio hook consulta PostgREST', 'sem service ou RPC intermediário'],
    persistence: ['vazios_importacao_manifests', 'vazios_importacao_containers'],
    evidence: [
      'src/pages/__tests__/Viagens.behavior.test.tsx',
      'src/components/voyages/__tests__/VoyageImportacaoTab.behavior.test.tsx',
      'não foi identificado teste dedicado',
    ],
  },
]

function requireTokens(column: string, tokens: string[], label: string) {
  for (const token of tokens) {
    expect(column, `${label} mapping is missing ${token}`).toContain(token)
  }
}

describe('S14 route-to-data traceability', () => {
  for (const contract of contracts) {
    it(`maps ${contract.label} through its owning layers and evidence`, () => {
      const row = rows.find((line) => line.includes(contract.marker))
      expect(row, `missing traceability row for ${contract.label}`).toBeDefined()
      if (!row) return

      const columns = row.split(/(?<!\\)\|/).slice(1, -1).map((column) => column.trim())
      expect(columns, `${contract.label} row must use the eight-column traceability contract`).toHaveLength(8)
      expect(columns[0]).toContain(contract.surface)
      requireTokens(columns[2] ?? '', contract.origin, `${contract.label} origin`)
      requireTokens(columns[3] ?? '', contract.orchestration, `${contract.label} orchestration`)
      requireTokens(columns[4] ?? '', contract.persistence, `${contract.label} persistence`)
      requireTokens(columns[6] ?? '', contract.evidence, `${contract.label} evidence`)

      for (const evidencePath of contract.evidence.filter((value) => value.startsWith('src/'))) {
        expect(existsSync(resolve(repositoryRoot, evidencePath)), `${evidencePath} must exist`).toBe(true)
      }
    })
  }
})
