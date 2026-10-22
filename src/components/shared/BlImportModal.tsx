import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { useCancellableFileRead } from '../../hooks/useCancellableFileRead'
import { useImportFileReceipt } from '../../hooks/useImportFileReceipt'
import { importFilesSha256 } from '../../services/importFileReceipt'
import { parseBLFile } from '../../services/blParser'
import {
  BlFreightImportRefused,
  confirmBlFreightImport,
  previewBlFreightImport,
  type BlCustomerChange,
  type BlFreightImportPreview,
  type BlFreightImportRow,
  type BlPriceSnapshot,
} from '../../services/blFreightImport'
import { afterManifestoImportado } from '../../services/cacheEffects'
import type { ImportIssue } from '../../services/importValidation'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { Modal } from '../ui/Modal'
import { SummaryStrip } from '../ui/SummaryStrip'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { useToast } from '../ui/Toast'
import { VoyageCombobox } from './VoyageCombobox'
import { ImportIssuesPanel } from './ImportIssuesPanel'
import { ImportReadProgress } from './ImportReadProgress'
import {
  ImportContext,
  ImportFileBlock,
  ImportFilePicker,
  ImportFootnote,
  ImportGuide,
  ImportNotice,
  PreviousImportNotice,
  ImportSection,
  ImportSteps,
  ImportTemplateLinks,
} from './ImportParts'
import { plural } from './importPresentation'
import { BL_PREVIEW_PAGE_SIZE, countContainerChanges, describeConsignee, describeOutcomeTotals } from './blImportPresentation'

/**
 * O que a confirmação gravou, mostrado no próprio modal (revisão de
 * 2026-10-22: totais, sem toast nem lista por B/L). As listas que ficam são
 * as que pedem ação do operador.
 */
type ConfirmOutcome = {
  imported: number
  /** containers que entraram e que saíram, somados de todos os B/Ls */
  containersIn: number
  containersOut: number
  refusedRelinks: string[]
  /** Troca de Consignatário sem aceite: o consignatário gravado ficou (migration 213) */
  customerKept: string[]
  calculationErrors: string[]
  /** B/Ls cancelados que ficaram de fora (ADR 0095, decisão 8) */
  cancelledSkipped: string[]
}

/** Preço fixado e preço de hoje, em texto: tabela, Condição e câmbio. */
function describePrice(snapshot: BlPriceSnapshot) {
  const tables = snapshot.tables.length ? snapshot.tables.join(', ') : 'sem tabela'
  const condition = snapshot.conditionItems ? plural(snapshot.conditionItems, 'item com Condição', 'itens com Condição') : 'sem Condição'
  const roe = snapshot.roe != null ? `câmbio ${snapshot.roe.toLocaleString('pt-BR', { minimumFractionDigits: 4 })}` : 'sem câmbio'
  const total = snapshot.totalBrl != null ? `, R$ ${snapshot.totalBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''
  return `${tables}; ${condition}; ${roe}${total}`
}

/**
 * Erros e avisos da prévia no painel comum (ADR 0092). Cada B/L é uma linha da
 * tabela da prévia; o número dela vai em "Linha" e o B/L no campo.
 */
function previewIssues(preview: BlFreightImportPreview): ImportIssue[] {
  return preview.rows.flatMap((row, index) => {
    const base = { row: index + 1, field: `B/L ${row.blNumber}`, code: 'invalid_group' as const }
    return [
      ...row.blockedReasons.map((message) => ({ ...base, severity: 'error' as const, message })),
      ...(row.payload && row.removedContainers?.length
        ? [{ ...base, severity: 'warning' as const, message: `Saem do B/L: ${row.removedContainers.join(', ')}.` }]
        : []),
      ...(row.warnings ?? []).map((message) => ({ ...base, severity: 'warning' as const, message })),
    ]
  })
}

export function BlImportModal({
  open,
  onClose,
  voyageId = null,
  voyageLabel,
  onlyBlId = null,
}: {
  open: boolean
  onClose: () => void
  voyageId?: number | null
  voyageLabel?: string
  onlyBlId?: string | null
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [files, setFiles] = useState<File[]>([])
  const { parsing, progress, readFiles, cancel: cancelReading } = useCancellableFileRead<Awaited<ReturnType<typeof parseBLFile>>>(parseBLFile)
  const [preview, setPreview] = useState<BlFreightImportPreview | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Confirmação de faturamento por B/L (ADR 0078, item 17).
  const [overrideBls, setOverrideBls] = useState<ReadonlySet<string>>(new Set())
  const [confirmCustomerChange, setConfirmCustomerChange] = useState(false)
  // Refixar o preço por B/L (ADR 0094, A2): sem marcar, o preço fixado fica.
  const [refixBls, setRefixBls] = useState<ReadonlySet<string>>(new Set())
  const [selectedVoyageId, setSelectedVoyageId] = useState<number | null>(voyageId)
  const receipt = useImportFileReceipt('arquivo_bl', selectedVoyageId, files)
  const [readError, setReadError] = useState<string | null>(null)
  /** Algum dos arquivos escolhidos não pôde ser lido: com vários, um ruim bloqueia todos. */
  const [readFailed, setReadFailed] = useState(false)
  const [confirmError, setConfirmError] = useState<{ message: string; refused: string[] } | null>(null)
  const [outcome, setOutcome] = useState<ConfirmOutcome | null>(null)
  // A prévia consulta o banco com a viagem da hora e não é cancelável: só a
  // última leitura publica (como no CE Mercante). Trocar a viagem, escolher
  // outro arquivo ou fechar invalida a que estava em curso.
  const previewRequestRef = useRef(0)

  const issues = useMemo(() => (preview ? previewIssues(preview) : []), [preview])
  const hasErrors = readFailed || issues.some((issue) => issue.severity === 'error')
  const importableCount = preview && !hasErrors ? preview.rows.filter((row) => row.payload).length : 0
  const customerChangeCount = preview?.summary.customerChangeCount ?? 0
  const customerChangeRows = useMemo(
    () => preview?.rows.filter((row) => row.customerChange) ?? [],
    [preview],
  )
  const priceRefixRows = useMemo(
    () => preview?.rows.filter((row) => row.priceRefix && row.payload) ?? [],
    [preview],
  )
  const billingOverrideRows = useMemo(
    () => preview?.rows.filter((row) => row.requiresBillingOverride && row.payload) ?? [],
    [preview],
  )

  function toggleIn(setter: typeof setOverrideBls, blNumber: string, checked: boolean) {
    setter((current) => {
      const next = new Set(current)
      if (checked) next.add(blNumber)
      else next.delete(blNumber)
      return next
    })
  }

  function resetDecisions() {
    setOverrideBls(new Set())
    setConfirmCustomerChange(false)
    setRefixBls(new Set())
  }

  // Gravação em andamento: X, Escape e Voltar não fecham (como no CE
  // Mercante); fechar no meio deixava a gravação seguindo sem tela.
  function requestClose() {
    if (submitting) {
      showToast('Aguarde: a gravação ainda está em andamento.', 'info')
      return
    }
    resetAndClose()
  }

  function resetAndClose() {
    previewRequestRef.current += 1
    setFiles([])
    setPreview(null)
    cancelReading()
    setSubmitting(false)
    resetDecisions()
    setSelectedVoyageId(voyageId ?? null)
    setReadError(null)
    setReadFailed(false)
    setConfirmError(null)
    setOutcome(null)
    onClose()
  }

  function handleVoyageSelect(nextVoyageId: number | null) {
    previewRequestRef.current += 1
    cancelReading()
    setSelectedVoyageId(nextVoyageId)
    setPreview(null)
    resetDecisions()
  }

  async function handleFiles(selectedFiles: File[]) {
    const request = ++previewRequestRef.current
    setFiles(selectedFiles)
    setPreview(null)
    resetDecisions()
    setReadError(null)
    setReadFailed(false)
    setConfirmError(null)
    setOutcome(null)
    if (!selectedFiles.length) return
    // O seletor fica desativado sem viagem; a guarda cobre o caminho por código.
    if (!selectedVoyageId) {
      setReadError('Escolha a viagem de destino antes do arquivo: a prévia compara o arquivo com ela.')
      return
    }

    const failures: string[] = []
    try {
      const documents = (await readFiles(selectedFiles, (error, file) => {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : 'Falha ao ler o arquivo.'}`)
      })) ?? []
      if (request !== previewRequestRef.current) return
      if (failures.length) {
        setReadError(failures.join(' | '))
        setReadFailed(true)
      }

      if (!documents.length) return

      const nextPreview = await previewBlFreightImport({
        documents,
        voyageId: selectedVoyageId,
        onlyBlId,
      })
      if (request !== previewRequestRef.current) return
      setPreview(nextPreview)
    } catch (error) {
      if (request !== previewRequestRef.current) return
      setReadError(error instanceof Error ? error.message : 'Falha ao preparar a prévia do B/L.')
    }
  }

  async function handleConfirm() {
    if (!preview || importableCount === 0) return
    if (!selectedVoyageId) return

    setSubmitting(true)
    setConfirmError(null)
    try {
      const result = await confirmBlFreightImport(
        preview,
        user?.id ?? '',
        overrideBls,
        receipt.filename ?? undefined,
        confirmCustomerChange,
        refixBls,
        // A prévia pode ficar pronta antes do hash: calcula aqui se faltar.
        receipt.fileHash ?? await importFilesSha256(files).catch(() => null),
      )
      const customerKept = result.customerChangesIgnored ?? []
      const containers = countContainerChanges(result)
      await afterManifestoImportado(queryClient, { voyageId: selectedVoyageId })
      // A confirmação fica no próprio modal, com os totais e só as pendências
      // que pedem ação; o toast cobria o botão Concluir (revisão de 2026-10-22).
      setOutcome({
        imported: importableCount,
        containersIn: containers.in,
        containersOut: containers.out,
        refusedRelinks: result.refusedCustomerRelinks.map((relink) => `${relink.blNumber} (${relink.blockers.join(' ')})`),
        customerKept,
        calculationErrors: result.calculationErrors.map((failure) => `${failure.blNumber} (${failure.message})`),
        cancelledSkipped: (result.cancelledSkipped ?? []).map((entry) => entry.message),
      })
    } catch (error) {
      // A gravação é uma transação só (migration 335): na falha, nada entrou.
      setConfirmError({
        message: error instanceof Error ? error.message : 'Nada foi gravado: falha ao importar o B/L.',
        refused: error instanceof BlFreightImportRefused ? error.refused : [],
      })
    } finally {
      setSubmitting(false)
    }
  }

  const outcomePending = Boolean(outcome && (outcome.refusedRelinks.length || outcome.customerKept.length || outcome.calculationErrors.length || outcome.cancelledSkipped.length))
  let footnote: ReactNode = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  let footnoteTone: 'default' | 'warning' | 'success' = 'default'
  if (outcome) {
    footnote = outcomePending ? 'Importação gravada com pendências; veja acima.' : 'Importação gravada.'
    footnoteTone = outcomePending ? 'warning' : 'success'
  } else if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (hasErrors) {
    footnote = 'Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.'
    footnoteTone = 'warning'
  } else if (preview) footnote = `${plural(importableCount, 'B/L será gravado', 'B/Ls serão gravados')}. Nada foi gravado ainda.`
  const step = outcome ? 'resultado' : preview || readError ? 'previa' : 'arquivo'
  const allBillingConfirmed = billingOverrideRows.length > 0 && billingOverrideRows.every((row) => overrideBls.has(row.blNumber))

  return (
    <Modal open={open} onClose={requestClose} title="Importar B/L de container">
      <div className="app-import">
        <ImportSteps current={step} />
        {onlyBlId ? (
          <ImportContext label="B/L">
            <span className="app-import-code">{onlyBlId}</span>
          </ImportContext>
        ) : null}

        <VoyageCombobox
          key={`${open ? 'open' : 'closed'}-${voyageId ?? 'none'}-${voyageLabel ?? ''}`}
          required
          initialValue={voyageLabel}
          selectedVoyageId={selectedVoyageId}
          onSelect={handleVoyageSelect}
        />

        <ImportFileBlock templates={<ImportTemplateLinks baseName="bl-container-modelo" extensions={['xlsx']} />}>
          <ImportGuide
            requiredLabel="Formato"
            required={<>planilha do B/L no layout da COSCO, um B/L por arquivo; vários arquivos de uma vez.</>}
            details={
              <p>
                O sistema lê as células pela posição, como no modelo, e a modalidade FCL/LCL pelo Type of Movement. A
                aba VIN é ignorada: veículos entram só pela planilha de Veículos. Com erro em qualquer B/L, nada é
                gravado; B/L cancelado fica de fora com aviso.
              </p>
            }
          />
          <ImportFilePicker
            accept=".xlsx,.xls"
            multiple
            positional
            files={files}
            onFiles={(next) => void handleFiles(next)}
            disabled={!selectedVoyageId || submitting || Boolean(outcome)}
            disabledReason={!selectedVoyageId ? 'Escolha a viagem de destino: a prévia compara o navio e a viagem do arquivo com ela.' : undefined}
          />
        </ImportFileBlock>

        {parsing ? <ImportReadProgress progress={progress} /> : null}

        {readError ? (
          <ImportNotice tone="danger" role="alert" title={readFailed ? 'Não foi possível ler o arquivo' : 'Não foi possível montar a prévia'}>
            <p>{readError}</p>
            <p>Confira o arquivo e escolha de novo. Nada foi gravado.</p>
          </ImportNotice>
        ) : null}

        {preview ? <PreviousImportNotice message={receipt.previousImportMessage} /> : null}

        {preview ? <BlImportPreview preview={preview} /> : null}

        {issues.length ? (
          <ImportIssuesPanel
            issues={issues}
            filename="bl-container-problemas.csv"
            title={hasErrors
              ? `${plural(issues.filter((issue) => issue.severity === 'error').length, 'erro impede', 'erros impedem')} a importação`
              : undefined}
            hint={hasErrors ? 'Com erro em qualquer B/L, nada é gravado. Corrija o arquivo e escolha de novo.' : undefined}
          />
        ) : null}

        {billingOverrideRows.length && !outcome && !hasErrors ? (
          <ImportSection title="Faturamento" aside={plural(billingOverrideRows.length, 'B/L com impacto', 'B/Ls com impacto')}>
            <p className="app-import-inspection">
              Decisão por B/L: marcado, a fatura emitida segue a base nova (reemissão automática sem pagamento; com
              pagamento, restituição). Sem marcar, o B/L é importado com os demais campos e as mudanças com impacto em
              faturamento ficam como estão.
            </p>
            {billingOverrideRows.length > 1 ? (
              <OverrideCheckbox
                checked={allBillingConfirmed}
                onChange={(checked) => setOverrideBls(checked ? new Set(billingOverrideRows.map((row) => row.blNumber)) : new Set())}
                title={`Confirmar o faturamento nos ${plural(billingOverrideRows.length, 'B/L', 'B/Ls')} (${plural(overrideBls.size, 'marcado', 'marcados')})`}
                hint="Marca ou desmarca todos os B/Ls abaixo."
              />
            ) : null}
            {billingOverrideRows.map((row) => (
              <OverrideCheckbox
                key={row.blNumber}
                checked={overrideBls.has(row.blNumber)}
                onChange={(checked) => toggleIn(setOverrideBls, row.blNumber, checked)}
                title={`Confirmar o faturamento do B/L ${row.blNumber}`}
                hint={row.billingImpacts.join('; ')}
              />
            ))}
          </ImportSection>
        ) : null}

        {priceRefixRows.length && !outcome && !hasErrors ? (
          <ImportSection title="Preço" aside={`muda em ${plural(priceRefixRows.length, 'B/L', 'B/Ls')}`}>
            <p className="app-import-inspection">
              O preço do B/L fica o do dia da importação. Marcado, o B/L passa ao preço de hoje (tabela, Condição e
              câmbio); sem marcar, o preço fixado fica e só a mudança do arquivo é aplicada.
            </p>
            {priceRefixRows.map((row) => (
              <OverrideCheckbox
                key={row.blNumber}
                checked={refixBls.has(row.blNumber)}
                onChange={(checked) => toggleIn(setRefixBls, row.blNumber, checked)}
                title={`Passar o B/L ${row.blNumber} ao preço de hoje`}
                hint={`Preço do dia da importação${row.priceRefix!.before.referenceDate ? ` (${row.priceRefix!.before.referenceDate})` : ''}: ${describePrice(row.priceRefix!.before)} → preço de hoje: ${describePrice(row.priceRefix!.after)}.`}
              />
            ))}
          </ImportSection>
        ) : null}

        {customerChangeRows.length && !outcome && !hasErrors ? (
          <ImportSection title="Troca de consignatário" aside={`em ${plural(customerChangeRows.length, 'B/L', 'B/Ls')}`}>
            {customerChangeRows.map((row) => (
              <CustomerChangeCard key={row.blNumber} blNumber={row.blNumber} change={row.customerChange!} />
            ))}
            {customerChangeCount > 0 ? (
              <OverrideCheckbox
                checked={confirmCustomerChange}
                onChange={setConfirmCustomerChange}
                title={`Confirmo a troca de cliente em ${plural(customerChangeCount, 'B/L', 'B/Ls')}`}
                hint="O B/L passa a pertencer ao novo consignatário e as taxas locais são reemitidas; com recebimento, devolva ao Cliente original antes da nova cobrança. Sem marcar, o Cliente, o consignatário e o CNPJ gravados ficam como estão e os demais campos são aplicados."
              />
            ) : null}
          </ImportSection>
        ) : null}

        {confirmError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>{confirmError.message}</p>
            {confirmError.refused.length ? (
              <ul className="app-import-notice__list">
                {confirmError.refused.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}
            <p>A prévia continua aqui; corrija o arquivo e escolha de novo, ou confirme de novo se o problema já foi resolvido.</p>
          </ImportNotice>
        ) : null}

        {outcome ? (
          <ImportSection title="Resultado">
            <ImportNotice
              tone={outcomePending ? 'warning' : 'success'}
              role="status"
              title={`Importação concluída: ${describeOutcomeTotals(outcome)}${outcomePending ? ', com pendências' : ''}`}
            >
              {outcome.refusedRelinks.length ? (
                <>
                  <p>A troca de cliente foi recusada; o B/L continua com o cliente anterior:</p>
                  <ul className="app-import-notice__list">
                    {outcome.refusedRelinks.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </>
              ) : null}
              {outcome.customerKept.length ? (
                <p>
                  Consignatário mantido em {outcome.customerKept.join(', ')}: a troca de cliente não foi confirmada. O
                  Cliente, o consignatário e o CNPJ gravados ficaram; os demais campos foram aplicados.
                </p>
              ) : null}
              {outcome.cancelledSkipped.length ? (
                <>
                  <p>B/Ls cancelados que ficaram como estavam:</p>
                  <ul className="app-import-notice__list">
                    {outcome.cancelledSkipped.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </>
              ) : null}
              {outcome.calculationErrors.length ? (
                <>
                  <p>Ficaram sem cálculo automático de taxas locais; recalcule na ficha do B/L:</p>
                  <ul className="app-import-notice__list">
                    {outcome.calculationErrors.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </>
              ) : null}
            </ImportNotice>
          </ImportSection>
        ) : null}

        <div className="app-modal__actions">
          <ImportFootnote tone={footnoteTone}>{footnote}</ImportFootnote>
          {outcome ? (
            <Button onClick={resetAndClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={submitting} onClick={parsing ? cancelReading : requestClose}>
                {parsing ? 'Interromper leitura' : 'Voltar'}
              </Button>
              <Button
                disabled={!selectedVoyageId || importableCount === 0 || parsing}
                loading={submitting}
                loadingLabel="Importando…"
                onClick={() => void handleConfirm()}
              >
                {importableCount > 0 ? `Importar ${plural(importableCount, 'B/L', 'B/Ls')}` : 'Importar B/Ls'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** Aceite do molde (`app-import-override`): decisão de campo, não de erro. */
function OverrideCheckbox({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  title: ReactNode
  hint: ReactNode
}) {
  return (
    <label className="app-import-override">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="app-import-override__title">{title}</span>
        <span className="app-import-override__hint">{hint}</span>
      </span>
    </label>
  )
}

const STATUS_LABEL: Record<BlFreightImportRow['status'], string> = {
  new: 'Cria',
  updated: 'Atualiza',
  unchanged: 'Sem mudança',
  blocked: 'Erro',
  skipped: 'Cancelado, fica de fora',
}

/** Situação em texto (regra 5): vermelho para erro, âmbar quando a mudança pede decisão. */
function statusTone(row: BlFreightImportRow) {
  if (row.status === 'blocked') return 'app-import-tone--danger'
  if (row.status === 'skipped') return 'app-import-tone--warning'
  const needsDecision = row.requiresBillingOverride || row.customerChange || row.priceRefix || row.removedContainers?.length
  return row.status === 'updated' && needsDecision ? 'app-import-tone--warning' : undefined
}

function BlImportPreview({ preview }: { preview: BlFreightImportPreview }) {
  const { newCount, updatedCount, unchangedCount, blockedCount } = preview.summary
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(preview.rows.length / BL_PREVIEW_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const offset = (currentPage - 1) * BL_PREVIEW_PAGE_SIZE
  const pageRows = preview.rows.slice(offset, offset + BL_PREVIEW_PAGE_SIZE)
  const unidentified = preview.rows.filter((row) => describeConsignee(row)?.identified === false).length
  return (
    <ImportSection
      title="Prévia"
      aside={
        <SummaryStrip
          label="O que a importação faz"
          items={[
            { label: newCount === 1 ? 'novo' : 'novos', value: newCount },
            { label: updatedCount === 1 ? 'atualizado' : 'atualizados', value: updatedCount },
            { label: 'sem mudança', value: unchangedCount },
            { label: 'com erro', value: blockedCount, tone: blockedCount ? 'danger' : 'default' },
            ...(unidentified ? [{ label: 'CNPJ não identificado', value: unidentified, tone: 'warning' as const }] : []),
          ]}
        />
      }
    >
      <div className="app-table-scroll app-import-table">
        <table className="app-table app-table--compact min-w-[860px]">
          <caption className="sr-only">B/Ls do arquivo e o que a importação faz com cada um</caption>
          <thead>
            <tr>
              <th scope="col" className="app-import-num">Linha</th>
              <th scope="col">B/L</th>
              <th scope="col">Situação</th>
              <th scope="col">Viagem</th>
              <th scope="col">POL → POD</th>
              <th scope="col">Embarque</th>
              <th scope="col">Consignatário</th>
              <th scope="col" className="app-table__text-head">Diferenças</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, index) => {
              const consignee = describeConsignee(row)
              return (
                <tr key={row.blNumber}>
                  <td className="app-import-num">{offset + index + 1}</td>
                  <td className="app-import-code">{row.blNumber}</td>
                  <td className={statusTone(row)}>{STATUS_LABEL[row.status]}</td>
                  <td>{row.voyageNumber ?? <NoValue label="Sem viagem" />}</td>
                  <td>{row.pol || row.pod ? `${row.pol ?? '—'} → ${row.pod ?? '—'}` : <NoValue label="Sem trecho" />}</td>
                  <td className="tabular-nums">{row.ladenOnBoard ?? <NoValue label="Sem data de embarque" />}</td>
                  <td>
                    {consignee ? (
                      <span className="app-table__cell-stack">
                        {consignee.document ? <span className="tabular-nums">{consignee.document}</span> : null}
                        <span className={consignee.identified ? undefined : 'app-import-tone--warning'}>{consignee.label}</span>
                      </span>
                    ) : <NoValue label="Não gravado" />}
                  </td>
                  <td>
                    <DiffList row={row} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <TableFooterPagination
        page={currentPage}
        pageSize={BL_PREVIEW_PAGE_SIZE}
        totalCount={preview.rows.length}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </ImportSection>
  )
}

/**
 * O aviso que o operador lê antes de aceitar: de quem para quem o B/L vai, o que
 * a fatura faz, e o que impede a troca quando ela não pode ser automática.
 */
function CustomerChangeCard({ blNumber, change }: { blNumber: string; change: BlCustomerChange }) {
  return (
    <ImportNotice tone="warning" title={<span className="app-import-code">{blNumber}</span>}>
      <ul className="app-import-notice__list">
        {change.messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
        {change.blockedReasons.map((reason) => (
          <li key={reason}>Impedimento: {reason}</li>
        ))}
      </ul>
      {change.blockedReasons.length ? (
        <p>O cliente deste B/L não será trocado; os demais campos seguem sendo aplicados.</p>
      ) : null}
    </ImportNotice>
  )
}

function DiffList({ row }: { row: BlFreightImportRow }) {
  if (!row.diffs.length) {
    return <NoValue label="Sem diferenças" />
  }

  return (
    <ul className="app-table__cell-stack app-import-diff">
      {row.diffs.map((diff) => (
        <li key={`${row.blNumber}-${diff.field}`} className={diff.billingImpact ? 'app-import-tone--warning' : undefined}>
          <span>{diff.label}</span>:{' '}
          <span className="app-import-diff__old">{formatDiffValue(diff.from, 'Vazio antes')}</span>{' → '}<span>{formatDiffValue(diff.to, 'Vazio depois')}</span>
          {diff.billingImpact ? <span> (faturamento)</span> : null}
        </li>
      ))}
    </ul>
  )
}

function formatDiffValue(value: string | number | null, emptyLabel: string) {
  if (value === null || value === '') return <NoValue label={emptyLabel} />
  return String(value)
}
