import { chunkArray } from '../lib/utils'
import { extractNcmCodes } from '../lib/ncm'
import { findMatchedCustomer, loadCustomerMaps, resolveCustomerLink } from './customerReconciliation'
import { supabase } from './supabase'
import type { Json } from '../types/database'
import {
  buildBreakbulkSummaryDescription,
  parseBreakbulkManifestBuffer,
  parseBreakbulkManifestFile,
  type ParsedBreakbulkManifest,
} from './breakbulkManifestParser'

export {
  parseBreakbulkManifestBuffer,
  parseBreakbulkManifestFile,
  type ParsedBreakbulkManifest,
}

export async function importBreakbulkManifest({
  filename,
  voyageId,
  manifest,
  uploadedBy,
  allowRowErrors = false,
}: {
  filename: string
  voyageId: number
  manifest: ParsedBreakbulkManifest
  uploadedBy: string
  /** Permite persistir as linhas válidas quando o preview tem erros de linha. */
  allowRowErrors?: boolean
}) {
  if (manifest.rowErrors.length && !allowRowErrors) throw new Error(formatBreakbulkRowErrors(manifest.rowErrors))

  const { error: voyageError } = await supabase.from('voyages').select('id').eq('id', voyageId).single()
  if (voyageError) throw voyageError

  const customerMaps = await loadCustomerMaps()

  const existingModeByBl = new Map<string, 'container' | 'carga_solta' | 'misto' | null>()
  const blIds = manifest.bls.map((bl) => bl.bl_id)
  for (const chunk of chunkArray(blIds, 400)) {
    const { data, error } = await supabase.from('bls').select('id, cargo_mode').in('id', chunk)
    if (error) throw error
    for (const row of data ?? []) {
      existingModeByBl.set(String(row.id), (row.cargo_mode as 'container' | 'carga_solta' | 'misto' | null) ?? null)
    }
  }

  const invalidBls = new Set<string>()
  const importErrors = [...manifest.rowErrors]

  const blRows = manifest.bls.flatMap((bl) => {
    const existingMode = existingModeByBl.get(bl.bl_id)
    const targetMode = existingMode === 'container' || existingMode === 'misto' ? ('misto' as const) : ('carga_solta' as const)

    const customerMatch = findMatchedCustomer(
      {
        cnpjCpf: bl.cnpj_cpf,
        consignee: bl.consignee,
      },
      customerMaps,
    )
    const link = resolveCustomerLink(customerMatch)
    const reviewReasons = new Set<string>()

    if (!link.customerId) {
      reviewReasons.add('Cliente nao vinculado automaticamente')
    }

    const ceMercante = bl.ce_mercante == null ? {} : { ce_mercante: bl.ce_mercante }

    return [
      {
        id: bl.bl_id,
        voyage_id: voyageId,
        cargo_mode: targetMode,
        // A ausência do campo é intencional: a RPC preserva atomicamente o CE
        // existente quando o layout não é autoridade sobre esse dado.
        ...ceMercante,
        bb_machine_qty: bl.bb_machine_qty,
        bb_packages_qty: bl.bb_packages_qty,
        bb_packages_total: bl.bb_packages_total,
        bb_weight_ton: bl.bb_weight_ton,
        shipper: bl.shipper,
        consignee: customerMatch?.matchType === 'document' ? customerMatch.customer.name : bl.consignee,
        notify_party: bl.notify_party,
        customer_id: link.customerId,
        suggested_customer_id: link.suggestedCustomerId,
        manifest_customer_cnpj_cpf: bl.cnpj_cpf,
        manifest_customer_name: bl.consignee,
        manifest_customer_email: null,
        customer_reconciliation_status: link.status,
        customer_reconciliation_notes: link.notes,
        billing_hold_reason:
          link.status === 'matched_document' ? null : 'Aguardando reconciliacao de cliente antes do faturamento.',
        pol: bl.pol,
        pod: bl.pod,
        cargo_description:
          manifest.layout === 'summary'
            ? buildBreakbulkSummaryDescription(bl)
            : bl.items.map((item) => item.item_description).filter(Boolean).slice(0, 3).join(' | ') || null,
        // A descrição acima descarta as linhas "NCM NUMBER" e guarda só os 3
        // primeiros itens; o NCM tem de sair do texto completo dos itens, senão
        // nunca chega ao B/L (migration 358).
        ncm_codes: [
          ...new Set(
            extractNcmCodes(bl.items.map((item) => item.item_description).filter(Boolean).join('\n')),
          ),
        ],
        total_weight_kg: bl.total_weight_kg,
        total_cbm: bl.total_cbm,
        review_status: reviewReasons.size > 0 ? ('pending_review' as const) : ('ok' as const),
        financial_status: 'pending' as const,
        notes: reviewReasons.size > 0 ? `Pendencias de importacao: ${Array.from(reviewReasons).join(', ')}` : null,
      },
    ]
  })

  const itemRows = manifest.bls
    .filter((bl) => !invalidBls.has(bl.bl_id))
    .flatMap((bl) =>
      bl.items.map((item) => ({
        bl_id: bl.bl_id,
        item_description: item.item_description,
        package_qty: item.package_qty,
        package_unit: item.package_unit,
        gross_weight_kg: item.gross_weight_kg,
        cbm: item.cbm,
        marks: item.marks,
      })),
    )

  const errorRows = importErrors.map((rowError) => ({
    row_number: rowError.row > 0 ? rowError.row : null,
    error_type: 'parser',
    error_message: rowError.message,
    raw_data: rowError.raw as Json,
  }))

  const { data, error } = await supabase.rpc('import_breakbulk_manifest_transactional', {
    p_filename: filename,
    p_voyage_id: voyageId,
    p_uploaded_by: uploadedBy,
    p_total_bls: manifest.bls.length,
    p_bls: blRows,
    p_items: itemRows,
    p_errors: errorRows,
  })
  if (error) throw error
  const batchId = Number((data as { batch_id?: number } | null)?.batch_id)
  if (!Number.isFinite(batchId) || batchId <= 0) {
    throw new Error('A importacao BB nao retornou um lote valido.')
  }

  return batchId
}

function formatBreakbulkRowErrors(rowErrors: ParsedBreakbulkManifest['rowErrors']): string {
  const shown = rowErrors.slice(0, 20).map((error) => `Linha ${error.row}: ${error.message}`)
  const hidden = rowErrors.length - shown.length
  if (hidden > 0) shown.push(`... e mais ${hidden} linha${hidden === 1 ? '' : 's'} com divergências.`)
  return shown.join('\n')
}
