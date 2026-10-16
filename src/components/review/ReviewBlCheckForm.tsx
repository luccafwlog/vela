import { useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Input, Textarea } from '../ui/Input'
import type { ReviewQueueItem } from '../../hooks/useReview'
import { isBreakbulkCargoMode, isContainerCargoMode } from '../../lib/cargoMode'
import { parseImportNumber } from '../../lib/importNumber'
import { splitReviewNotes } from '../../pages/revisaoHelpers'

type BlItem = Extract<ReviewQueueItem, { source: 'bl' }>

export type ReviewBlCheckValues = {
  shipper: string
  consignee: string
  pol: string
  pod: string
  total_weight_kg: number | null
  total_cbm: number | null
  bb_weight_ton: number | null
  bb_cbm: number | null
  notes: string | null
  justification: string
}

type ParsedField = { value: number | null; error: string | null }

/**
 * Vazio limpa o campo; texto que não é número trava o salvar em vez de virar
 * vazio. Aceita "1.234,5" e "28000.5"; "24.000" é ambíguo e pede outra forma.
 */
function parseField(value: string): ParsedField {
  const parsed = parseImportNumber(value)
  if (parsed.kind === 'empty') return { value: null, error: null }
  if (parsed.kind === 'value') return { value: Number(parsed.decimal), error: null }
  return {
    value: null,
    error: parsed.reason === 'ambiguous'
      ? 'Número ambíguo: escreva sem o ponto de milhar (24000) ou com vírgula decimal (24,000).'
      : 'Informe um número (ex.: 1.234,5).',
  }
}

function initialOf(value: number | null | undefined) {
  return value ? String(value) : ''
}

/**
 * Caso F da Revisão ("Conferir os dados do B/L"): a pendência não diz o que
 * falta, então os dados do B/L abrem para conferir e salvar. Os demais casos
 * corrigem o B/L na ficha dele.
 */
export function ReviewBlCheckForm({
  item,
  saving,
  onSave,
}: {
  item: BlItem
  saving: boolean
  onSave: (item: BlItem, values: ReviewBlCheckValues) => void
}) {
  const [shipper, setShipper] = useState(item.shipper ?? '')
  const [consignee, setConsignee] = useState(item.consignee ?? '')
  const [pol, setPol] = useState(item.pol ?? '')
  const [pod, setPod] = useState(item.pod ?? '')
  const [weightKg, setWeightKg] = useState(initialOf(item.total_weight_kg))
  const [cbm, setCbm] = useState(initialOf(item.total_cbm))
  const [bbWeight, setBbWeight] = useState(initialOf(item.bb_weight_ton))
  const [bbCbm, setBbCbm] = useState(initialOf(item.bb_cbm))
  const [notes, setNotes] = useState(splitReviewNotes(item.notes))
  const [justification, setJustification] = useState('')
  // Cada modalidade edita as SUAS colunas; um B/L misto mostra os dois pares.
  const showContainer = !item.cargo_mode || isContainerCargoMode(item.cargo_mode)
  const showBreakbulk = Boolean(item.cargo_mode) && isBreakbulkCargoMode(item.cargo_mode)

  const weightField = parseField(weightKg)
  const cbmField = parseField(cbm)
  const bbWeightField = parseField(bbWeight)
  const bbCbmField = parseField(bbCbm)
  const invalid = [
    showContainer && weightField.error,
    showContainer && cbmField.error,
    showBreakbulk && bbWeightField.error,
    showBreakbulk && bbCbmField.error,
  ].some(Boolean)

  function reset() {
    setShipper(item.shipper ?? '')
    setConsignee(item.consignee ?? '')
    setPol(item.pol ?? '')
    setPod(item.pod ?? '')
    setWeightKg(initialOf(item.total_weight_kg))
    setCbm(initialOf(item.total_cbm))
    setBbWeight(initialOf(item.bb_weight_ton))
    setBbCbm(initialOf(item.bb_cbm))
    setNotes(splitReviewNotes(item.notes))
    setJustification('')
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Shipper"><Input value={shipper} onChange={(event) => setShipper(event.target.value)} /></Field>
        <Field label="Consignatário"><Input value={consignee} onChange={(event) => setConsignee(event.target.value)} /></Field>
        <Field label="POL"><Input value={pol} onChange={(event) => setPol(event.target.value)} /></Field>
        <Field label="POD"><Input value={pod} onChange={(event) => setPod(event.target.value)} /></Field>
        {showContainer ? (
          <>
            <Field label="Peso contêiner (kg)" error={weightField.error ?? undefined}><Input inputMode="decimal" value={weightKg} onChange={(event) => setWeightKg(event.target.value)} /></Field>
            <Field label="CBM contêiner (m³)" error={cbmField.error ?? undefined}><Input inputMode="decimal" value={cbm} onChange={(event) => setCbm(event.target.value)} /></Field>
          </>
        ) : null}
        {showBreakbulk ? (
          <>
            <Field label="Peso carga solta (t)" error={bbWeightField.error ?? undefined}><Input inputMode="decimal" value={bbWeight} onChange={(event) => setBbWeight(event.target.value)} /></Field>
            <Field label="CBM carga solta (m³)" error={bbCbmField.error ?? undefined}><Input inputMode="decimal" value={bbCbm} onChange={(event) => setBbCbm(event.target.value)} /></Field>
          </>
        ) : null}
      </div>
      <Field label="Descrição da carga" hint="Texto do B/L; não é alterado aqui.">
        <Textarea value={item.cargo_description ?? ''} placeholder="Descrição não extraída do B/L." readOnly />
      </Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Notas da revisão"><Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Opcional" /></Field>
        <Field label="Justificativa"><Input value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="Se vazia, registra “Revisão manual”" /></Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={saving} onClick={reset}>Descartar</Button>
        <Button
          disabled={invalid}
          loading={saving}
          loadingLabel="Salvando…"
          onClick={() => !invalid && onSave(item, {
            shipper,
            consignee,
            pol,
            pod,
            total_weight_kg: weightField.value,
            total_cbm: cbmField.value,
            bb_weight_ton: bbWeightField.value,
            bb_cbm: bbCbmField.value,
            notes: notes.trim() || null,
            justification: justification.trim() || 'Revisão manual',
          })}
        >
          Salvar revisão
        </Button>
      </div>
    </div>
  )
}
