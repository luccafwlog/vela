import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENCY_REPORT_SECTION_LABELS, AGENCY_REPORT_SECTIONS } from '../agencyDepartureReport'

const ownershipSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/258_agency_report_granite_equipamentos.sql'),
  'utf8',
)
const labelSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/065_pr705_contract_guards.sql'),
  'utf8',
)

describe('migration 258 — Granito pertence a Equipamentos no ADR', () => {
  it('mantém o contrato TypeScript e as funções SQL de dono e rótulo alinhados', () => {
    const owner = ownershipSql.match(/CREATE OR REPLACE FUNCTION public\.agency_report_section_owner[\s\S]*?\$\$;/)?.[0] ?? ''
    const label = labelSql.match(/CREATE OR REPLACE FUNCTION public\.agency_report_section_label[\s\S]*?\$\$;/)?.[0] ?? ''

    for (const [section, department] of Object.entries(AGENCY_REPORT_SECTIONS)) {
      expect(owner).toContain(`WHEN '${section}' THEN '${department}'`)
    }
    for (const [section, text] of Object.entries(AGENCY_REPORT_SECTION_LABELS)) {
      expect(label).toContain(`WHEN '${section}' THEN '${text}'`)
    }
    expect(label).toContain("WHEN 'operacao_patio' THEN 'Operação de pátio'")
    expect(label).toContain("WHEN 'ocorrencias' THEN 'Ocorrências'")
  })
})
