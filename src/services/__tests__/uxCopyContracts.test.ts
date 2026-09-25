import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('does not promise unsupported schedule confirmation or update times', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/portal/ShipScheduleWidget.tsx'), 'utf8')
  expect(source).not.toContain('Evento confirmado')
  expect(source).not.toContain('Atualização diária às 09:00')
  expect(source).toContain('data programada já alcançada')
  expect(source).toContain('Atualizado conforme os dados publicados')
})

it('uses neutral report-limit copy instead of claiming one global limit', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Relatorios.tsx'), 'utf8')
  expect(source).not.toContain('Limite de 2.000 linhas por consulta')
  expect(source).toContain('Cada visão informa seu próprio limite')
})

it('exposes the audit author filter and clears it with the other filters', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Admin.tsx'), 'utf8')
  expect(source).toContain('Autor (ID)')
  expect(source).toContain('value={logFilters.changedBy}')
  expect(source).toContain('logFilters.entityType || logFilters.changedBy || logFilters.dateFrom || logFilters.dateTo')
})

it('uses the voyage-backed schedule flow instead of the legacy schedule export', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/ChegadasSaidas.tsx'), 'utf8')
  expect(source).toContain('createOrAttachVoyageFromSchedule')
  // Tirar a viagem da Programação só acontece em Viagens (Excluir/Cancelar) ou
  // pelo último ATD (ADR 0071, item 12): a tela não desliga a publicação.
  expect(source).not.toContain('setVoyageShowOnPortal')
  expect(source).not.toContain('vessel_schedules')
  expect(source).not.toContain('ended_vessels')
})

// Migration 077 (decisão R1 de 2026-09-23): todo Departamento ativo importa o
// Baplie; a substituição de um Baplie existente pede confirmação.
it('exposes Baplie import and reimport controls to every active internal user', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Baplie.tsx'), 'utf8')
  expect(source).not.toMatch(/canUploadManifests = isAdmin/)
  expect(source).toContain('const canUploadManifests = Boolean(profile || user)')
  expect(source).toContain('baplieReplacementMessage(existing, filteredContainers.length)')
  expect(source).toContain('<StateA canImport={canUploadManifests}')
  expect(source).toContain('canUploadManifests ?')
  expect(source).toContain('A importação do Baplie exige um usuário interno ativo.')
  expect(source).toContain('const canImportVazios = Boolean(profile || user)')
  expect(source).toContain('canWrite={canImportVazios}')
})
