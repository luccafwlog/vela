import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Lê o catálogo SQL de alertas direto das migrations, para que os testes de
// contrato comparem o manual da tela com a verdade do banco em vez de uma
// cópia mantida à mão.
export type SqlAlertCatalogEntry = {
  type: string
  severity: 'critical' | 'normal'
  responsibleDepartment: string
  audienceDepartments: string[]
  defaultDestination: string
  active: boolean
}

// Lista de migrations que semeiam o catálogo de alertas. Se novas migrations
// adicionarem tipos de alertas no futuro, registre o arquivo aqui.
const CATALOG_MIGRATIONS = [
  '317_alerts_foundation_catalog.sql',
  '325_clientes_portal_disputes_alerts.sql',
  '372_comunicados_fundacao.sql',
  '374_comunicados_alertas.sql',
  '377_portal_invoice_exception_audience.sql',
  '024_demurrage_ptax_alert.sql',
  '026_import_effect_alert.sql',
]

// Migrations que aposentam tipos. Aceitam tanto `type IN (...)` quanto
// `type = '...'`; registre aqui cada nova migration que desativa um tipo.
const DEACTIVATION_MIGRATIONS = [
  '347_alerts_retire_dead_invoice_types.sql',
  '348_taxas_locais_sem_vencimento.sql',
]

// Migrations que mudam gravidade, responsável ou audiência de um tipo já
// semeado (`UPDATE public.alert_type_catalog SET ... WHERE type = '...'`).
const CATALOG_UPDATE_MIGRATIONS = [
  '078_alertas_pix_administrativo_granito_normal.sql',
  '083_portal_trava_universal_liberacao_faturamento.sql',
]

const CATALOG_UPDATE_PATTERN = /UPDATE\s+public\.alert_type_catalog\s+SET\s+([\s\S]*?)\s+WHERE\s+type\s*=\s*'([a-z0-9_]+)'/gi

const ENTRY_PATTERN = /\(\s*'([a-z0-9_]+)',\s*'(critical|normal)',\s*'([a-z_]+)',\s*ARRAY\[([^\]]*)\],\s*'([^']+)'\s*\)/g
const DEACTIVATION_PATTERN = /SET\s+active\s*=\s*false\s+WHERE\s+type\s+(?:IN\s*\(([^)]*)\)|=\s*('[a-z0-9_]+'))/i
const AUDIENCE_UPDATE_PATTERN = /UPDATE\s+public\.alert_type_catalog\s+SET\s+audience_departments\s*=\s*ARRAY\[([^\]]*)\][^;]*?WHERE\s+type\s*=\s*'([a-z0-9_]+)'/gi

function readMigration(fileName: string): string {
  return readFileSync(resolve(process.cwd(), 'supabase/migrations', fileName), 'utf8')
}

export function readSqlAlertCatalog(): SqlAlertCatalogEntry[] {
  const entries = new Map<string, SqlAlertCatalogEntry>()

  for (const fileName of CATALOG_MIGRATIONS) {
    const migration = readMigration(fileName)
    for (const match of migration.matchAll(ENTRY_PATTERN)) {
      const [, type, severity, responsibleDepartment, audience, defaultDestination] = match
      entries.set(type, {
        type,
        severity: severity as 'critical' | 'normal',
        responsibleDepartment,
        audienceDepartments: Array.from(audience.matchAll(/'([a-z_]+)'/g), (item) => item[1]),
        defaultDestination,
        active: true,
      })
    }
    for (const match of migration.matchAll(AUDIENCE_UPDATE_PATTERN)) {
      const [, audience, type] = match
      const entry = entries.get(type)
      if (entry) entry.audienceDepartments = Array.from(audience.matchAll(/'([a-z_]+)'/g), (item) => item[1])
    }
  }

  for (const fileName of CATALOG_UPDATE_MIGRATIONS) {
    for (const match of readMigration(fileName).matchAll(CATALOG_UPDATE_PATTERN)) {
      const [, assignments, type] = match
      const entry = entries.get(type)
      if (!entry) continue
      const severity = assignments.match(/severity\s*=\s*'(critical|normal)'/)
      if (severity) entry.severity = severity[1] as 'critical' | 'normal'
      const responsible = assignments.match(/responsible_department\s*=\s*'([a-z_]+)'/)
      if (responsible) entry.responsibleDepartment = responsible[1]
      const audience = assignments.match(/audience_departments\s*=\s*ARRAY\[([^\]]*)\]/)
      if (audience) entry.audienceDepartments = Array.from(audience[1].matchAll(/'([a-z_]+)'/g), (item) => item[1])
    }
  }

  for (const fileName of DEACTIVATION_MIGRATIONS) {
    const deactivation = readMigration(fileName).replace(/\s+/g, ' ').match(DEACTIVATION_PATTERN)
    const retired = deactivation?.[1] ?? deactivation?.[2] ?? ''
    for (const match of retired.matchAll(/'([a-z0-9_]+)'/g)) {
      const entry = entries.get(match[1])
      if (entry) entry.active = false
    }
  }

  return Array.from(entries.values())
}

export function activeSqlAlertTypes(): string[] {
  return readSqlAlertCatalog().filter((entry) => entry.active).map((entry) => entry.type)
}
