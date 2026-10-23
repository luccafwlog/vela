import type { BlFreightImportResult, BlFreightImportRow } from '../../services/blFreightImport'
import { formatCnpjCpf } from '../../lib/utils'
import { plural } from './importPresentation'

/** Totais de containers que entraram e saíram, de todos os B/Ls gravados. */
export function countContainerChanges(result: Pick<BlFreightImportResult, 'containerChanges'>) {
  return (result.containerChanges ?? []).reduce(
    (totals, entry) => ({ in: totals.in + entry.inserted.length, out: totals.out + entry.removed.length }),
    { in: 0, out: 0 },
  )
}

/** "12 B/Ls gravados · 40 containers entraram", com os que saíram quando houver. */
export function describeOutcomeTotals(outcome: { imported: number; containersIn: number; containersOut: number }) {
  return [
    plural(outcome.imported, 'B/L gravado', 'B/Ls gravados'),
    plural(outcome.containersIn, 'container entrou', 'containers entraram'),
    outcome.containersOut ? plural(outcome.containersOut, 'container saiu', 'containers saíram') : null,
  ].filter(Boolean).join(' · ')
}

/** Linhas por página da prévia: arquivos com dezenas de B/Ls não somem no rolar da tabela. */
export const BL_PREVIEW_PAGE_SIZE = 10

/**
 * Consignatário do B/L como a gravação vai tratá-lo: o CNPJ lido e se ele casou
 * um Cliente cadastrado (`matched_document`). Casado só pelo nome ou sem
 * Cliente, o CNPJ conta como não identificado.
 */
export function describeConsignee(row: BlFreightImportRow): { document: string | null; label: string; identified: boolean } | null {
  const payload = row.payload
  if (!payload) return null
  const document = payload.manifest_customer_cnpj_cpf ? formatCnpjCpf(payload.manifest_customer_cnpj_cpf) : null
  if (payload.customer_reconciliation_status === 'matched_document') return { document, label: 'CNPJ identificado', identified: true }
  if (payload.customer_reconciliation_status === 'matched_name') return { document, label: 'CNPJ não identificado; Cliente pelo nome', identified: false }
  return { document, label: document ? 'CNPJ não identificado' : 'Sem CNPJ no arquivo', identified: false }
}
