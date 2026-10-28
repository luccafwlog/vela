import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = (name: string) => readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8')

describe('fundação transversal de alertas', () => {
  it('materializa o catálogo único de gravidade e faz o console consumi-lo', () => {
    const sql = migration('317_alerts_foundation_catalog.sql')

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.alert_type_catalog')
    expect(sql).toContain("'portal_abuso_login', 'critical'")
    expect(sql).toContain("'portal_convite_expirado', 'normal'")
    expect(sql).toContain("'portal_falha_envio', 'normal'")
    expect(sql).toContain("'invoice_payment_invalid'")
    expect(sql).toContain("'invoice_cancel_blocked'")
    expect(sql).toContain('public.alert_type_catalog')
    expect(sql).toContain("al.type IN ('portal_excecao_critica_fatura','portal_convite_expirado','portal_falha_envio','portal_abuso_login')")
    expect(sql).not.toContain('atc.severity = \'critical\'')
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.portal_list_provisioning_console\(/)
    expect(sql).toContain('pg_get_functiondef')
  })

  it('cria agregado, itens, histórico, dispensa e notificação por destinatário', () => {
    const sql = migration('318_alerts_foundation_lifecycle.sql')

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.alert_items')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.alert_item_events')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.alert_item_dismissals')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.internal_notifications')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.alert_notification_failures')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.upsert_alert_item')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.dismiss_alert_item')
    expect(sql).toContain('review_at > now()')
    expect(sql).toContain('read_at')
    expect(sql).toContain('is_fallback')
    expect(sql).toContain('RLS por destinatário')
    expect(sql).toContain('acknowledged')
    expect(sql).not.toContain('SET type = \'aggregate\'')
    expect(sql).toContain('CREATE TRIGGER route_catalog_alert_insert\n  AFTER INSERT')
    expect(sql).toContain("v_reopened := v_item.status = 'resolved'")
    expect(sql).toMatch(/ORDER BY[\s\S]*a\.type = p_type[\s\S]*a\.type = 'aggregate'/)
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.sync_legacy_alert_item_lifecycle')
    expect(sql).toContain('CREATE TRIGGER sync_legacy_alert_item_lifecycle')
    expect(sql).toContain('AFTER UPDATE OF status ON public.alerts')
    expect(sql).toContain("p_source <> 'foundation_backfill'")
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.resolve_invoice_alerts_on_status_change[\s\S]*resolve_alert_item\(/)
    expect(sql).toContain('pg_trigger_depth() > 0')
    expect(sql).toContain("set_config('alerts.foundation_trigger', 'on', true)")
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.resolve_portal_alert_items_on_account_change')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.resolve_demurrage_alert_on_status_change')
    expect(sql).toContain('LIMIT 200')
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.list_internal_notifications[\s\S]*public\.is_active_read_user\(\)/)
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.list_internal_notifications[\s\S]*public\.is_active_user\(\)/)
    expect(sql).not.toContain('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated')
    expect(sql).toContain('REVOKE USAGE, SELECT ON SEQUENCE')
    expect(sql).toContain('count_alert_queue')
    expect(sql).toContain('p_entity_type TEXT DEFAULT NULL')
    expect(sql).toContain("SET status = 'closed'")
    expect(sql).toContain("set_config('request.jwt.claim.role', 'service_role', true)")
  })

  it('agenda a reconciliação sem chamar RPCs autenticadas diretamente pelo cron', () => {
    const sql = migration('319_alerts_detector_schedule.sql')

    expect(sql).toMatch(/cron\.schedule\([\s\S]*'alerts-foundation-detectors'[\s\S]*'\*\/15 \* \* \* \*'/)
    expect(sql).toContain("'/functions/v1/alerts-detector'")
    expect(sql).toContain('net.http_post')
    expect(sql).not.toContain('SELECT public.detect_overdue_invoices()')
    expect(sql).not.toContain('SELECT public.detect_agency_report_pending()')
    expect(sql).not.toContain('SELECT public.detect_agency_report_deadline_missed()')
    expect(sql).toContain("auth.role() IS DISTINCT FROM 'service_role'")
    expect(sql).toContain('RAISE WARNING')
    expect(sql).not.toContain("AND NULLIF(v_url, '') IS NOT NULL")
    expect(sql).toContain("role <> 'equipamentos'")
  })

  it('retira a detecção da tela e a ação de reconhecimento da fila', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/Alertas.tsx'), 'utf8')

    expect(page).not.toContain('acknowledgeAlert')
    expect(page).not.toContain('Reconhecer')
    expect(page).not.toContain('detectAgencyReportPending')
    expect(page).not.toContain('detectAgencyReportDeadlineMissed')
    // A dispensa saiu na migration 476 (ADR 0108).
    expect(page).not.toContain('Dispensar')
  })

  it('mantém uma chave única por item no painel financeiro', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/components/billing/FinancialAlertsPanel.tsx'), 'utf8')

    expect(panel).toContain('key={alert.item_id ?? alert.id}')
  })

  it('mantém o rótulo da fatura criada pelo Portal', () => {
    const labels = readFileSync(resolve(process.cwd(), 'src/services/alerts.ts'), 'utf8')

    expect(labels).toContain("portal_invoice_created: 'Fatura criada no portal'")
  })

  it('mantém os três arquivos de migration no repositório para o rollout', () => {
    for (const name of ['317_alerts_foundation_catalog.sql', '318_alerts_foundation_lifecycle.sql', '319_alerts_detector_schedule.sql']) {
      expect(existsSync(resolve(process.cwd(), 'supabase/migrations', name))).toBe(true)
    }
  })
})
