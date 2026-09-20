import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/066_auditoria_maritima_remediations.sql'), 'utf8')

describe('migration 066 — auditorias marítimas', () => {
  it('fecha as invariantes P0/P1 no banco', () => {
    expect(sql).toContain('assert_demurrage_invoice_complete')
    expect(sql).toContain('return_date IS NULL')
    expect(sql).toContain('ledger_payment_requests')
    expect(sql).toContain('p_request_id uuid')
    expect(sql).toContain('guard_missing_charge_price')
    expect(sql).toContain('guard_shared_container_invoice')
    expect(sql).not.toContain("COALESCE(dispute_open, false) = false")
    expect(sql).toContain('cod_adjustments_one_pending_transition_idx')
    expect(sql).toContain('inclusive quando a reprecificação concluiu que não havia diferença')
    expect(sql).toContain('HAVING count(*) > 1')
  })

  it('persiste Laden on Board, sela viagem cancelada e protege exportação', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS laden_on_board date')
    expect(sql).toContain('cancel_voyage')
    expect(sql).toContain('guard_voyage_cancelled_mutation')
    expect(sql).toContain('Use cancel_voyage para cancelar a viagem')
    expect(sql).toContain('guard_voyage_report_cancelled_mutation')
    expect(sql).toContain('guard_voyage_schedule_audit_cancelled')
    expect(sql).toContain('guard_export_schedule_removal')
    expect(sql).toContain('recalcula o menor ATD')
  })
})
