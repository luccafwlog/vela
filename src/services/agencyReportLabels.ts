// Seções do relatório de saída da agência e os rótulos em português (ADR 0036).
// Módulo leve de propósito: o sino de notificações aparece em toda tela.
import type { UserProfileRole } from '../types/database'

// Seis seções assináveis (ADR 0036). 'operacao_patio' foi absorvida por
// 'vazios_embarcados' — Embarque de Vazios é UM agregado por escala
// (CONTEXT.md), e suas duas partes (unidades embarcadas e linhas de serviço)
// são subseções de conteúdo, não resoluções independentes.
export type AgencyReportSection =
  | 'datas'
  | 'carga_descarregada'
  | 'carga_carregada'
  | 'veiculos'
  | 'vazios_embarcados'
  | 'vazios_descarregados'

export const AGENCY_REPORT_SECTIONS: Record<AgencyReportSection, UserProfileRole> = {
  datas: 'operacoes',
  carga_descarregada: 'documentacao',
  carga_carregada: 'equipamentos',
  veiculos: 'equipamentos',
  vazios_embarcados: 'equipamentos',
  vazios_descarregados: 'documentacao',
}

// Labels pt-BR das seções e departamentos do ADR — espelham as funções SQL
// agency_report_section_label/agency_report_department_label (migration 258).
export const AGENCY_REPORT_SECTION_LABELS: Record<AgencyReportSection, string> = {
  datas: 'Escala',
  carga_descarregada: 'Carga descarregada',
  // ADR 0036: "A seção `carga_carregada` chama-se 'Carga carregada', com o
  // granito como seu conteúdo — não como seu nome." Renomear para "Granito"
  // foi listado como alternativa rejeitada ("vira mentira na primeira carga
  // de exportação que não for granito"). Decisão confirmada com o usuário em
  // 2026-09-19. A função SQL agency_report_section_label foi realinhada pela
  // migration 065 (supersede o CASE de 'Granito' que a migration 258 havia
  // gravado); os dois lados ficam sincronizados por
  // agencyReportGraniteOwnershipMigration.test.ts.
  carga_carregada: 'Carga carregada',
  veiculos: 'Veículos',
  vazios_embarcados: 'Embarque de vazios',
  vazios_descarregados: 'Vazios descarregados',
}

// Rótulo de uma chave de seção que pode vir de registro histórico (snapshot
// fechado, audit_log) — 'operacao_patio' e 'ocorrencias' não são mais
// assináveis, mas continuam precisando ser legíveis. Espelha o ELSE da função
// SQL agency_report_section_label.
const AGENCY_REPORT_RETIRED_SECTION_LABELS: Record<string, string> = {
  operacao_patio: 'Operação de pátio',
  ocorrencias: 'Ocorrências',
}

export function agencyReportSectionLabel(section: string): string {
  return (
    AGENCY_REPORT_SECTION_LABELS[section as AgencyReportSection] ??
    AGENCY_REPORT_RETIRED_SECTION_LABELS[section] ??
    section
  )
}

export const AGENCY_REPORT_DEPARTMENT_LABELS: Record<string, string> = {
  operacoes: 'Operações',
  documentacao: 'Documentação',
  equipamentos: 'Equipamentos',
}
