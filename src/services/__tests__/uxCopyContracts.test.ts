import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('does not promise unsupported schedule confirmation or update times', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/portal/ShipScheduleWidget.tsx'), 'utf8')
  expect(source).not.toContain('Evento confirmado')
  expect(source).not.toContain('Atualização diária às 09:00')
  // A data efetiva é a registrada (ATD/ATA), não "a data alcançada": a
  // legenda diz de onde vem cada data.
  expect(source).toContain('data efetiva: saída ou chegada registrada')
  // Lote 4: a faixa do bloco leva só o nome do serviço, sem prometer horário.
  expect(source).toContain('CSSC Container Liner Service Schedule – ECSA')
})

it('uses neutral report-limit copy instead of claiming one global limit', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Relatorios.tsx'), 'utf8')
  expect(source).not.toContain('Limite de 2.000 linhas por consulta')
  // Lote 5b (R2): o aviso só aparece quando o recorte passa do teto da tela,
  // diz quantas linhas faltam e que a planilha traz todas.
  expect(source).toContain('A planilha traz todas.')
})

it('exposes the audit author filter as a list of people and clears it with the other filters', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/admin/AdminHistoryTab.tsx'), 'utf8')
  // Lote 5b: "Por" é a lista de pessoas (e "Sistema"), no lugar do número interno do autor.
  expect(source).not.toContain('Autor (ID)')
  expect(source).toContain('<Field label="Por">')
  expect(source).toContain('value={filters.changedBy}')
  expect(source).toContain('filters.subject || filters.changedBy || filters.dateFrom || filters.dateTo')
  expect(source).toContain('setFilters(EMPTY_FILTERS)')
})

it('uses the voyage-backed schedule flow instead of the legacy schedule export', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/ChegadasSaidas.tsx'), 'utf8')
  expect(source).toContain('createOrAttachVoyageFromSchedule')
  // Tirar a viagem da Programação é na Viagem (chave da edição, Excluir ou
  // Cancelar; ADR 0097) ou pelo último ATD: esta tela não desliga a publicação.
  expect(source).not.toContain('setVoyageShowOnPortal')
  expect(source).not.toContain('vessel_schedules')
  expect(source).not.toContain('ended_vessels')
})

// Migration 077 (decisão R1 de 2026-09-23): todo Departamento ativo importa o
// Baplie; a substituição de um Baplie existente com diferença pede confirmação.
it('exposes Baplie import and reimport controls to every active internal user', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Baplie.tsx'), 'utf8')
  expect(source).not.toMatch(/canUploadManifests = isAdmin/)
  expect(source).toContain('const canUploadManifests = Boolean(profile || user)')
  // A confirmação da substituição é do modal comum (A1 do lote 6a), aberto daqui.
  expect(source).toContain('<BaplieImportModal')
  expect(readFileSync(resolve(process.cwd(), 'src/components/shared/BaplieImportModal.tsx'), 'utf8')).toContain('confirm(baplieReplacementConfirmOptions(plan, filteredContainers.length))')
  expect(source).toContain('<StateA canImport={canUploadManifests}')
  expect(source).toContain('canUploadManifests ?')
  expect(source).toContain('A importação do Baplie exige um usuário interno ativo.')
  expect(source).toContain('const canImportVazios = Boolean(profile || user)')
  expect(source).toContain('canWrite={canImportVazios}')
})
