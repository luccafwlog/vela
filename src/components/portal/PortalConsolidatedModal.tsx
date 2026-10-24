import { useId, useMemo, useState } from 'react'
import { FilePlus2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Block } from '../ui/Block'
import { InlineError } from '../ui/Card'
import { Combobox, type ComboOption } from '../ui/Combobox'
import { CopyValue } from '../ui/CopyValue'
import { Field, Input } from '../ui/Input'
import { NoValue } from '../ui/NoValue'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { usePortalConsolidatableReceivables, usePortalCreateConsolidation } from '../../hooks/usePortalBilling'
import { isReceivableSelectable } from '../billing/consolidatedInvoiceSelection'
import { formatBRL, voyageDisplayName } from '../../lib/utils'
import { usePortalScope } from '../../hooks/usePortalScope'
import { isPortalReadOnly } from '../../services/portalScope'
import type { ConsolidatableReceivable } from '../../types/database'
import { matchesAnyToken } from '../../lib/searchTerms'

type Props = {
  open: boolean
  onClose: () => void
  onCreated?: (invoiceId: number | null) => void
}

const blCount = (count: number) => `${count} ${count === 1 ? 'B/L' : 'B/Ls'}`
const voyageOf = (row: ConsolidatableReceivable) => voyageDisplayName(row.vessel_name, row.voyage_number) ?? ''
const normalize = (value: string) => value.replace(/\s+/g, '').toUpperCase()
// B/L já pago não aparece na janela (lote 4): nada a juntar.
const isPaid = (row: ConsolidatableReceivable) => row.receivable_status === 'settled' || row.eligibility_status === 'paid'

/**
 * Gerar fatura consolidada no Portal (lote 4 da identidade, 2026-10-18).
 * Filtros por B/L e por Navio / Viagem no topo; os B/Ls que podem entrar com
 * caixa de seleção; os que têm saldo mas não podem entrar num bloco fechado,
 * com o motivo do banco. A seleção vale mesmo quando o filtro esconde a linha,
 * e o pé soma o que está marcado. Quem pode entrar é decisão do banco
 * (`eligibility_status`); no Modo Inspeção a emissão fica desligada.
 */
export function PortalConsolidatedModal({ open, onClose, onCreated }: Props) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { data: receivables, isLoading, error } = usePortalConsolidatableReceivables()
  const createMutation = usePortalCreateConsolidation()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)
  const blockedTableId = useId()
  const [selected, setSelected] = useState<number[]>([])
  const [blFilter, setBlFilter] = useState('')
  const [voyageFilter, setVoyageFilter] = useState('')
  // A caixa de busca da viagem guarda o próprio texto: trocar a chave a limpa.
  const [voyageKey, setVoyageKey] = useState(0)
  const [blockedOpen, setBlockedOpen] = useState(false)

  const rows = useMemo(() => (receivables ?? []).filter((row) => !isPaid(row)), [receivables])
  const eligibleRows = rows.filter(isReceivableSelectable)
  const blockedRows = rows.filter((row) => !isReceivableSelectable(row) && Number(row.balance_brl ?? 0) > 0)
  const shownRows = [...eligibleRows, ...blockedRows]

  const blQuery = normalize(blFilter)
  const voyageQuery = voyageFilter.trim().toLowerCase()
  const filtering = Boolean(blQuery || voyageQuery)
  const matches = (row: ConsolidatableReceivable) =>
    (!blQuery || normalize(row.bl_id).includes(blQuery) || matchesAnyToken(blFilter, [row.bl_id])) && (!voyageQuery || voyageOf(row).toLowerCase().includes(voyageQuery))
  const visibleEligible = eligibleRows.filter(matches)
  const visibleBlocked = blockedRows.filter(matches)

  // Só as viagens dos B/Ls desta janela, com quantos B/Ls cada uma tem.
  const voyageCounts = new Map<string, number>()
  for (const row of shownRows) {
    const label = voyageOf(row)
    if (label) voyageCounts.set(label, (voyageCounts.get(label) ?? 0) + 1)
  }
  const voyageOptions = Array.from(voyageCounts, ([label, count]): ComboOption => ({ value: label, label, meta: blCount(count) }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const selectedRows = eligibleRows.filter((row) => selected.includes(row.receivable_id))
  const selectedTotal = selectedRows.reduce((total, row) => total + Number(row.balance_brl ?? 0), 0)
  const hiddenSelected = selectedRows.filter((row) => !matches(row)).length
  const allVisibleSelected = visibleEligible.length > 0 && visibleEligible.every((row) => selected.includes(row.receivable_id))

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // Marcar todos vale para as linhas mostradas; o que o filtro esconde fica como está.
  function toggleAllVisible() {
    const ids = visibleEligible.map((row) => row.receivable_id)
    setSelected((prev) => (allVisibleSelected ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]))
  }

  function clearFilters() {
    setBlFilter('')
    setVoyageFilter('')
    setVoyageKey((key) => key + 1)
  }

  function close() {
    setSelected([])
    clearFilters()
    setBlockedOpen(false)
    onClose()
  }

  async function submit() {
    if (selected.length === 0) {
      showToast('Selecione ao menos um B/L para consolidar.', 'error')
      return
    }
    if (selectedRows.length !== selected.length) {
      showToast('A seleção mudou. Atualize a lista e selecione novamente os B/Ls elegíveis.', 'error')
      return
    }
    const confirmed = await confirm({
      title: 'Emitir fatura consolidada',
      message: `Emitir uma fatura consolidada de ${formatBRL(selectedTotal)} para sua empresa?`,
      confirmLabel: 'Consolidar e emitir',
      affected: {
        summary: `${blCount(selectedRows.length)} · ${formatBRL(selectedTotal)} em saldos abertos`,
        items: selectedRows.map((row) => `B/L ${row.bl_id} · ${formatBRL(row.balance_brl)} · ${[row.vessel_name, row.voyage_number].filter(Boolean).join(' ') || 'viagem não informada'}`),
      },
      consequence: 'Cria a fatura consolidada, vincula os recebíveis selecionados e registra o evento financeiro. A invoice emitida ficará disponível no Portal e esses saldos não poderão entrar em outra invoice ativa.',
      reversibility: 'O Portal não permite apagar ou cancelar invoices. Se a consolidada ficar obsoleta, os recebíveis elegíveis podem ser consolidados novamente; pagamentos seguem o fluxo de estorno.',
    })
    if (!confirmed) return
    try {
      const payload = await createMutation.mutateAsync({ receivableIds: selectedRows.map((row) => row.receivable_id) })
      showToast('Fatura consolidada emitida com sucesso.', 'success')
      setSelected([])
      onCreated?.(Number(payload.invoice_id ?? 0) || null)
      close()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao consolidar cobranças.', 'error')
    }
  }

  return (
    <Modal open={open} onClose={close} title="Gerar fatura consolidada">
      <div className="grid gap-4">
        <p className="text-sm text-[var(--app-muted)]">Junte os B/Ls com saldo em aberto numa fatura só, paga com um Pix.</p>

        <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filtros">
          <div className="w-full sm:w-60">
            <Field label="B/L">
              <Input value={blFilter} placeholder="Número do B/L" onChange={(event) => setBlFilter(event.target.value)} />
            </Field>
          </div>
          <div className="w-full sm:w-72">
            <Combobox
              key={voyageKey}
              label="Navio / Viagem"
              placeholder="Nome do navio ou viagem"
              onValueChange={() => undefined}
              onInputChange={setVoyageFilter}
              fetchOptions={async (query) => voyageOptions.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()))}
              onSelectOption={(option) => setVoyageFilter(option.label)}
            />
          </div>
          {filtering ? <Button variant="secondary" className="app-btn--sm" onClick={clearFilters}>Limpar filtros</Button> : null}
        </div>

        {error ? (
          <InlineError message="Não foi possível consultar os B/Ls. Feche e abra de novo antes de emitir." />
        ) : isLoading ? (
          <p className="text-sm text-[var(--app-muted)]">Buscando os B/Ls com saldo em aberto…</p>
        ) : (
          <>
            <Block title="B/Ls que podem entrar" aside={filtering ? `${visibleEligible.length} de ${eligibleRows.length}` : eligibleRows.length} headingLevel={3} flush>
              {eligibleRows.length === 0 ? (
                <p className="px-4 py-3 text-sm text-[var(--app-muted)]">Nenhum B/L com saldo em aberto pode entrar numa consolidada agora.</p>
              ) : (
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact text-sm">
                    <caption className="sr-only">B/Ls que podem entrar na fatura consolidada</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="w-11">
                          <input
                            type="checkbox"
                            aria-label="Marcar todos os B/Ls mostrados"
                            checked={allVisibleSelected}
                            disabled={readOnly || visibleEligible.length === 0}
                            onChange={toggleAllVisible}
                          />
                        </th>
                        <th scope="col">B/L</th>
                        <th scope="col" className="app-table__text-head">Navio / Viagem</th>
                        <th scope="col">Fatura de hoje</th>
                        <th scope="col">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEligible.length === 0 ? (
                        <tr><td colSpan={5} className="text-[var(--app-muted)]">Nenhum B/L com esses filtros.</td></tr>
                      ) : visibleEligible.map((row) => (
                        <tr key={row.receivable_id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Selecionar B/L ${row.bl_id}`}
                              checked={selected.includes(row.receivable_id)}
                              disabled={readOnly}
                              onChange={() => toggle(row.receivable_id)}
                            />
                          </td>
                          <td><CopyValue value={row.bl_id} label="número do B/L" /></td>
                          <td className="app-table__text">{voyageOf(row) || <NoValue label="Sem navio e viagem" />}</td>
                          <td className="whitespace-nowrap">{row.individual_invoice_number ?? <NoValue label="Sem fatura" />}</td>
                          <td className="whitespace-nowrap tabular-nums">{formatBRL(row.balance_brl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Block>

            {blockedRows.length > 0 ? (
              <Block
                title="Com saldo, mas não podem entrar"
                headingLevel={3}
                flush
                aside={<>
                  <span>{filtering ? `${visibleBlocked.length} de ${blockedRows.length}` : blockedRows.length}</span>
                  <Button variant="ghost" className="app-btn--sm" aria-expanded={blockedOpen} aria-controls={blockedTableId} onClick={() => setBlockedOpen((value) => !value)}>
                    {blockedOpen ? 'Esconder' : 'Mostrar'}
                  </Button>
                </>}
              >
                {blockedOpen ? (
                  <div className="app-table-scroll" id={blockedTableId}>
                    <table className="app-table app-table--compact text-sm">
                      <caption className="sr-only">B/Ls com saldo que não podem entrar na fatura consolidada</caption>
                      <thead>
                        <tr>
                          <th scope="col">B/L</th>
                          <th scope="col" className="app-table__text-head">Navio / Viagem</th>
                          <th scope="col">Saldo</th>
                          <th scope="col" className="app-table__text-head">Por quê</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleBlocked.length === 0 ? (
                          <tr><td colSpan={4} className="text-[var(--app-muted)]">Nenhum B/L com esses filtros.</td></tr>
                        ) : visibleBlocked.map((row) => (
                          <tr key={row.receivable_id} className="app-table__row--muted">
                            <td className="whitespace-nowrap">{row.bl_id}</td>
                            <td className="app-table__text">{voyageOf(row) || <NoValue label="Sem navio e viagem" />}</td>
                            <td className="whitespace-nowrap tabular-nums">{formatBRL(row.balance_brl)}</td>
                            <td className="app-table__text app-table__text--wrap">{row.eligibility_reason || <NoValue label="Motivo não informado" />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </Block>
            ) : null}
          </>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--app-border)] pt-4">
          <p className="text-sm" aria-live="polite">
            <strong>{blCount(selectedRows.length)} · {formatBRL(selectedTotal)}</strong>
            {hiddenSelected > 0 ? <span className="text-[var(--app-muted)]"> · {hiddenSelected === 1 ? '1 marcado fora do filtro' : `${hiddenSelected} marcados fora do filtro`}</span> : null}
          </p>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={close}>Voltar</Button>
            <Button
              onClick={() => void submit()}
              loading={createMutation.isPending}
              disabled={selectedRows.length === 0 || readOnly}
              title={readOnly ? 'Ação do cliente — indisponível em Modo Inspeção' : undefined}
            >
              <FilePlus2 size={16} />
              Consolidar e emitir
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
