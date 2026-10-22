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
  type BlFreightImportResult,
  type BlFreightImportRow,
  type BlPriceSnapshot,
} from '../../services/blFreightImport'
import { afterManifestoImportado } from '../../services/cacheEffects'
import type { ImportIssue } from '../../services/importValidation'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { Modal } from '../ui/Modal'
import { SummaryStrip } from '../ui/SummaryStrip'
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

/** O que a confirmação gravou, mostrado no próprio modal. */
type ConfirmOutcome = {
  imported: number
  refusedRelinks: string[]
  /** Troca de Consignatário sem aceite: o consignatário gravado ficou (migration 213) */
  customerKept: string[]
  calculationErrors: string[]
  /** containers que entraram, mudaram ou saíram, por B/L */
  changes: string[]
  /** B/Ls cancelados que ficaram de fora (ADR 0095, decisão 8) */
  cancelledSkipped: string[]
  /** B/Ls com o preço refixado pelo aceite */
  pricesRefixed: string[]
}

/** Frases por B/L do que a importação fez com os containers. */
function describeChanges(result: BlFreightImportResult) {
  const line = (entry: { blNumber: string; inserted: string[]; updated: string[]; removed: string[] }) => {
    const parts = [
      entry.inserted.length ? plural(entry.inserted.length, 'container entrou', 'containers entraram') : null,
      entry.updated.length ? plural(entry.updated.length, 'container atualizado', 'containers atualizados') : null,
      entry.removed.length ? `${plural(entry.removed.length, 'container saiu', 'containers saíram')}: ${entry.removed.join(', ')}` : null,
    ].filter(Boolean)
    return parts.length ? `${entry.blNumber} — ${parts.join('; ')}` : null
  }
  return (result.containerChanges ?? []).map(line).filter((item): item is string => Boolean(item))
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
      const { refusedCustomerRelinks, calculationErrors } = result
      const customerKept = result.customerChangesIgnored ?? []
      const changes = describeChanges(result)
      const cancelledSkipped = (result.cancelledSkipped ?? []).map((entry) => entry.message)
      const pricesRefixed = result.pricesRefixed ?? []
      await afterManifestoImportado(queryClient, { voyageId: selectedVoyageId })
      const refused = refusedCustomerRelinks.map((relink) => `${relink.blNumber} (${relink.blockers.join(' ')})`)
      const failedCalculations = calculationErrors.map((failure) => `${failure.blNumber} (${failure.message})`)
      if (refused.length || customerKept.length || failedCalculations.length || cancelledSkipped.length || changes.length || pricesRefixed.length) {
        // Importou com containers ou veículos alterados, ou algo pedido não
        // aconteceu: o modal fica aberto com o resultado por B/L. Fechar
        // esconderia o que mudou e o que o operador precisa resolver.
        const warnings: string[] = []
        if (refused.length) warnings.push(`a troca de cliente foi recusada em ${plural(refused.length, 'B/L', 'B/Ls')}: ${refused.join(' | ')}`)
        if (customerKept.length) warnings.push(`consignatário mantido em ${customerKept.join(', ')}: a troca não foi confirmada`)
        if (failedCalculations.length) warnings.push(`${plural(failedCalculations.length, 'B/L ficou', 'B/Ls ficaram')} sem cálculo automático: ${failedCalculations.join(' | ')}`)
        if (cancelledSkipped.length) warnings.push(`${plural(cancelledSkipped.length, 'B/L cancelado ficou', 'B/Ls cancelados ficaram')} de fora`)
        showToast(warnings.length ? `Importação gravada, mas ${warnings.join(' | ')}` : 'Importação gravada; confira o resultado por B/L.', warnings.length ? 'error' : 'success')
        setOutcome({
          imported: importableCount,
          refusedRelinks: refused,
          customerKept,
          calculationErrors: failedCalculations,
          changes,
          cancelledSkipped,
          pricesRefixed,
        })
        return
      }
      showToast(`Importação de B/L concluída: ${plural(importableCount, 'B/L gravado', 'B/Ls gravados')}.`, 'success')
      resetAndClose()
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
    footnote = outcomePending ? 'Importação gravada com pendências; veja acima.' : 'Importação gravada; veja acima o resultado por B/L.'
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
          <ImportSection title="Resultado" aside={plural(outcome.imported, 'B/L gravado', 'B/Ls gravados')}>
            <ImportNotice
              tone={outcomePending ? 'warning' : 'success'}
              role="status"
              title={`${plural(outcome.imported, 'B/L gravado', 'B/Ls gravados')}${outcomePending ? ', com pendências' : ''}`}
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
              {outcome.changes.length ? (
                <>
                  <p>Mudanças aplicadas por B/L:</p>
                  <ul className="app-import-notice__list">
                    {outcome.changes.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </>
              ) : null}
              {outcome.cancelledSkipped.length ? (
                <>
                  <p>B/Ls cancelados que ficaram como estavam:</p>
                  <ul className="app-import-notice__list">
                    {outcome.cancelledSkipped.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </>
              ) : null}
              {outcome.pricesRefixed.length ? (
                <p>Preço de hoje aplicado em {outcome.pricesRefixed.join(', ')}.</p>
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
          ]}
        />
      }
    >
      <div className="app-table-scroll app-import-table">
        <table className="app-table app-table--compact min-w-[760px]">
          <caption className="sr-only">B/Ls do arquivo e o que a importação faz com cada um</caption>
          <thead>
            <tr>
              <th scope="col" className="app-import-num">Linha</th>
              <th scope="col">B/L</th>
              <th scope="col">Situação</th>
              <th scope="col">Viagem</th>
              <th scope="col">POL → POD</th>
              <th scope="col">Embarque</th>
              <th scope="col" className="app-table__text-head">Diferenças</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, index) => (
              <tr key={row.blNumber}>
                <td className="app-import-num">{index + 1}</td>
                <td className="app-import-code">{row.blNumber}</td>
                <td className={statusTone(row)}>{STATUS_LABEL[row.status]}</td>
                <td>{row.voyageNumber ?? <NoValue label="Sem viagem" />}</td>
                <td>{row.pol || row.pod ? `${row.pol ?? '—'} → ${row.pod ?? '—'}` : <NoValue label="Sem trecho" />}</td>
                <td className="tabular-nums">{row.ladenOnBoard ?? <NoValue label="Sem data de embarque" />}</td>
                <td>
                  <DiffList row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
