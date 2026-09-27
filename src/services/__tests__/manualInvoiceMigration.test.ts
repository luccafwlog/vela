import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/097_fatura_avulsa.sql')
const portalScopeMigrationPath = resolve(process.cwd(), 'supabase/migrations/098_portal_manual_invoice_notes_scope.sql')

function compact(sql: string) {
  return sql.replace(/\s+/g, ' ')
}

function readMigration() {
  return existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
}

describe('migration 097 — fatura avulsa flexível', () => {
  it('declara o contexto opcional e o novo tipo sem reescrever dados existentes', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readMigration()
    const normalized = compact(sql)

    expect(normalized).toMatch(/ALTER TABLE public\.invoices ADD COLUMN IF NOT EXISTS voyage_id bigint/i)
    expect(normalized).toMatch(/ADD CONSTRAINT invoices_voyage_id_fkey[\s\S]*FOREIGN KEY \(voyage_id\) REFERENCES public\.voyages\(id\) ON DELETE RESTRICT/i)
    expect(normalized).toMatch(/CREATE INDEX IF NOT EXISTS idx_invoices_voyage_id ON public\.invoices\(voyage_id\)/i)
    expect(normalized).toMatch(/DROP CONSTRAINT IF EXISTS invoices_invoice_type_check/i)
    expect(normalized).toMatch(/CHECK \(invoice_type IN \('individual', 'consolidated', 'granite', 'manual'\)\)/i)
    expect(sql).toContain('Sem backfill: as linhas existentes permanecem inalteradas.')
    expect(sql).toContain('ROLLBACK')
  })

  it('define a emissão atômica com validações de autorização, contexto e total', () => {
    const sql = readMigration()
    const normalized = compact(sql)

    expect(normalized).toMatch(/CREATE OR REPLACE FUNCTION public\.create_manual_invoice\(/i)
    expect(normalized).toMatch(/p_customer_id bigint, p_item_name text, p_quantity numeric, p_unit_value_brl numeric/i)
    expect(normalized).toMatch(/p_description text DEFAULT NULL, p_bl_id text DEFAULT NULL, p_voyage_id bigint DEFAULT NULL, p_actor uuid DEFAULT NULL/i)
    expect(normalized).toMatch(/\) RETURNS jsonb/i)
    expect(normalized).toMatch(/auth\.uid\(\)[\s\S]*is_active_user\(\)[\s\S]*is_admin\(\)/i)
    expect(normalized).toMatch(/p_quantity IS NULL[\s\S]*p_quantity <= 0/i)
    expect(normalized).toMatch(/p_unit_value_brl IS NULL[\s\S]*p_unit_value_brl <= 0/i)
    expect(normalized).toMatch(/bls[\s\S]*customer_id[\s\S]*p_customer_id/i)
    expect(normalized).toMatch(/voyage_id[\s\S]*voyage_number/i)
    expect(normalized).toMatch(/v_total_brl[\s\S]*p_quantity[\s\S]*p_unit_value_brl/i)
    expect(normalized).toMatch(/INSERT INTO public\.invoices[\s\S]*invoice_type[\s\S]*'manual'[\s\S]*status[\s\S]*'issued'/i)
    expect(normalized).toMatch(/INSERT INTO public\.invoice_items[\s\S]*source[\s\S]*'manual'/i)
    expect(normalized).toMatch(/invoice_lifecycle_events[\s\S]*'issued'/i)
    expect(normalized).toMatch(/invoice_receivable_links|invoice_bls/)
    expect(normalized).toMatch(/REVOKE ALL ON FUNCTION public\.create_manual_invoice\([^)]*\) FROM PUBLIC, anon/i)
    expect(normalized).toMatch(/GRANT EXECUTE ON FUNCTION public\.create_manual_invoice\([^)]*\) TO authenticated/i)
  })

  it('mantém a fatura avulsa fora dos gates e do ledger local, mas dentro do PIX genérico', () => {
    const sql = readMigration()
    const normalized = compact(sql)

    expect(normalized).toMatch(/populate_local_invoice_pix_payload[\s\S]*manual/i)
    expect(normalized).toMatch(/reconcile_invoice_payment_by_txid[\s\S]*invoice_type IN \('individual', 'consolidated', 'manual'\)/i)
    expect(normalized).toMatch(/register_invoice_payment[\s\S]*invoice_type = 'manual'/i)
    expect(normalized).toMatch(/enforce_invoice_ce_on_issue[\s\S]*manual[\s\S]*RETURN NEW/i)
    expect(normalized).toMatch(/enforce_portal_invoice_gate[\s\S]*manual[\s\S]*RETURN NEW/i)
    expect(normalized).toMatch(/ledger_settlements[\s\S]*manual[\s\S]*register_invoice_payment/i)
    expect(normalized).toMatch(/cancel_invoice[\s\S]*manual[\s\S]*invoice_bls/i)
  })

  it('inclui manual sem BL nos núcleos seguros do Portal e preserva o escopo', () => {
    const sql = readMigration()
    const normalized = compact(sql)

    expect(normalized).toMatch(/_portal_list_invoices_core[\s\S]*invoice_type = 'manual'[\s\S]*customer_id = p_customer_id/i)
    expect(normalized).toMatch(/_portal_list_invoices_page_core[\s\S]*_portal_list_invoices_core/i)
    expect(normalized).toMatch(/_portal_invoice_details_core[\s\S]*current_portal_customer_id|_portal_invoice_details_core[\s\S]*p_customer_id/i)
    expect(normalized).toContain("'notes'")
    expect(normalized).toContain("'voyage_id'")
    expect(normalized).toMatch(/invoice_type = 'manual'[\s\S]*bl_id/i)
    expect(normalized).toMatch(/SET search_path TO 'public', 'pg_temp'|SET search_path = public, pg_temp/i)
  })

  it('expõe notes no Portal somente para faturas avulsas', () => {
    expect(existsSync(portalScopeMigrationPath)).toBe(true)
    const sql = readFileSync(portalScopeMigrationPath, 'utf8')
    const normalized = compact(sql)

    expect(normalized).toMatch(/RENAME TO _portal_invoice_details_core_20260927/i)
    expect(normalized).toMatch(/_portal_invoice_details_core_20260927\(p_customer_id, p_invoice_id\)/i)
    expect(normalized).toMatch(/v_result #>> '\{invoice,invoice_type\}' IS DISTINCT FROM 'manual'[\s\S]*\(v_result->'invoice'\) - 'notes'/i)
    expect(normalized).toMatch(/REVOKE ALL ON FUNCTION public\._portal_invoice_details_core\(bigint, bigint\) FROM PUBLIC, anon, authenticated, service_role/i)
  })
})
