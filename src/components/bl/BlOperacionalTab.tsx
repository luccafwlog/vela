import { useMemo, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Save } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { useInvoiceLinks } from '../../hooks/useBilling'
import { useBlLocalChargeLines } from '../../hooks/useLocalCharges'
import type { BlForm } from '../../hooks/useBlEditForm'
import { cargoModeLabel, type CargoMode } from '../../pages/blDetalheHelpers'
import { formatNcm, listBlNcms } from '../../lib/ncm'
import { normalizeText } from '../../lib/utils'
import { parseNcmInput } from '../../hooks/useBlEditForm'
import { REVIEW_STATUS_LABELS } from '../../lib/statusLabels'
import type { BL, BLDetail } from '../../types/database'

// Aba Operacional: formulário de edição manual do B/L. O pai (BlDetalhe) mantém o estado do form.
export function BlOperacionalTab({
  active,
  bl,
  form,
  changes,
  saving,
  justification,
  cargoMode,
  isContainerMode,
  hasContainers,
  onFieldChange,
  onJustificationChange,
  onSubmit,
}: {
  active: boolean
  bl: BLDetail
  form: BlForm
  changes: (keyof BlForm)[]
  saving: boolean
  justification: string
  cargoMode: CargoMode
  isContainerMode: boolean
  hasContainers: boolean
  onFieldChange: <K extends keyof BlForm>(field: K, value: BlForm[K] | string) => void
  onJustificationChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
}) {
  const { data: invoiceLinksByBl } = useInvoiceLinks([bl.id])
  const { data: localChargeLines } = useBlLocalChargeLines(bl.id)

  const latestInvoice = invoiceLinksByBl?.[bl.id]?.[0] ?? null

  const currentCalcTotal = useMemo(() => {
    if (!localChargeLines) return null
    return localChargeLines
      .filter((l) => l.status !== 'exempt')
      .reduce((sum, l) => sum + Number(l.total_value_brl ?? 0), 0)
  }, [localChargeLines])

  const invoiceDiverges = useMemo(() => {
    if (!latestInvoice?.total_brl || currentCalcTotal == null) return false
    if (latestInvoice.status !== 'issued') return false
    return Math.abs(currentCalcTotal - latestInvoice.total_brl) > 0.01
  }, [latestInvoice, currentCalcTotal])

  // NCM cadastrado no B/L (migration 358) e o que a descrição declara. Os dois
  // costumam coincidir, mas a descrição nem sempre traz o código — daí o campo
  // próprio, exigido pela manifestação no Mercante.
  const ncmSugerido = useMemo(() => listBlNcms(form.cargo_description), [form.cargo_description])
  const ncmCadastrado = useMemo(() => parseNcmInput(form.ncm_codes).map(formatNcm), [form.ncm_codes])
  const sugestaoAplicavel = useMemo(
    () => ncmSugerido.length > 0 && ncmSugerido.join(',') !== ncmCadastrado.join(','),
    [ncmSugerido, ncmCadastrado],
  )

  // O upsert da reimportação atualiza manifest_customer_name mas preserva
  // consignee. Sem este sinal, a ficha e a fila de reconciliação mostravam
  // nomes diferentes e nada dizia que havia divergência.
  const manifestConsigneeDiverges = useMemo(() => {
    const manifestName = String(bl.manifest_customer_name ?? '').trim()
    const blConsignee = String(form.consignee ?? '').trim()
    return Boolean(manifestName) && Boolean(blConsignee)
      && normalizeText(manifestName) !== normalizeText(blConsignee)
  }, [bl.manifest_customer_name, form.consignee])
  if (!active) return null

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusBadge label="Modo" value={cargoModeLabel(cargoMode)} tone={cargoMode === 'misto' ? 'yellow' : isContainerMode ? 'blue' : 'green'} />
          <StatusBadge label="Revisão" value={REVIEW_STATUS_LABELS[bl.review_status ?? 'ok'] ?? bl.review_status ?? 'ok'} />
          {invoiceDiverges ? (
            <Badge tone="yellow">Taxas recalculadas — a fatura pode estar desatualizada</Badge>
          ) : null}
          {changes.length ? <Badge tone="yellow">{changes.length} alteracao(oes) pendentes</Badge> : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="col-span-full border-b border-[var(--app-border)] pb-1 text-sm font-semibold text-[var(--app-text-strong)]">Partes</div>
          <Field label="Armador / Navio / Viagem">
            {bl.voyage_id ? (
              <Link className="block rounded-md border border-[var(--app-border)] px-3 py-2 text-sm font-semibold text-[#58a6ff] hover:underline" to={`/viagens/${bl.voyage_id}`}>
                {`${bl.voyage?.vessel?.carrier?.name ?? '-'} / ${bl.voyage?.vessel?.name ?? '-'} / ${bl.voyage?.voyage_number ?? '-'}`}
              </Link>
            ) : <Input disabled value="-" />}
          </Field>
          <div className="col-span-full border-b border-[var(--app-border)] pb-1 text-sm font-semibold text-[var(--app-text-strong)]">Rota e datas</div>
          <Field label="Place of Receipt">
            <Input value={form.place_of_receipt ?? ''} onChange={(event) => onFieldChange('place_of_receipt', event.target.value)} />
          </Field>
          <Field label="POL">
            <Input value={form.pol ?? ''} onChange={(event) => onFieldChange('pol', event.target.value)} />
          </Field>
          <Field label="POD">
            <Input value={form.pod ?? ''} onChange={(event) => onFieldChange('pod', event.target.value)} />
          </Field>
          <Field label="Place of Delivery">
            <Input value={form.place_of_delivery ?? ''} onChange={(event) => onFieldChange('place_of_delivery', event.target.value)} />
          </Field>
          <Field label="Movement From">
            <Input value={form.movement_from ?? ''} onChange={(event) => onFieldChange('movement_from', event.target.value)} />
          </Field>
          <Field label="Movement To" hint="Contendo LCL ou CFS, isenta veículo de taxa local no destino. Ausente ou outra notação cobra normalmente.">
            <Input value={form.movement_to ?? ''} onChange={(event) => onFieldChange('movement_to', event.target.value)} />
          </Field>
          <Field label="Data de emissao">
            <Input type="date" value={(form.bl_emission_date ?? '').slice(0, 10)} onChange={(event) => onFieldChange('bl_emission_date', event.target.value)} />
          </Field>
          <Field label="Local de emissao">
            <Input value={form.issue_place ?? ''} onChange={(event) => onFieldChange('issue_place', event.target.value)} />
          </Field>
          <Field label="CE Mercante">
            <Input
              value={form.ce_mercante ?? ''}
              onChange={(event) => onFieldChange('ce_mercante', event.target.value)}
            />
          </Field>
          {!isContainerMode ? (
            <>
              <Field label="Máquinas">
                <Input
                  type="number"
                  value={form.bb_machine_qty ?? ''}
                  onChange={(event) => onFieldChange('bb_machine_qty', event.target.value)}
                />
              </Field>
              <Field label="Packages">
                <Input
                  type="number"
                  value={form.bb_packages_qty ?? ''}
                  onChange={(event) => onFieldChange('bb_packages_qty', event.target.value)}
                />
              </Field>
              <Field label="Packages Total">
                <Input
                  type="number"
                  value={form.bb_packages_total ?? ''}
                  onChange={(event) => onFieldChange('bb_packages_total', event.target.value)}
                />
              </Field>
              <Field label="Weight (Ton)">
                <Input
                  type="number"
                  value={form.bb_weight_ton ?? ''}
                  onChange={(event) => onFieldChange('bb_weight_ton', event.target.value)}
                />
              </Field>
              <Field label="CBM carga solta (m³)">
                <Input
                  type="number"
                  value={form.bb_cbm ?? ''}
                  onChange={(event) => onFieldChange('bb_cbm', event.target.value)}
                />
              </Field>
            </>
          ) : null}

          <Field label="Shipper">
            <Input value={form.shipper ?? ''} onChange={(event) => onFieldChange('shipper', event.target.value)} />
          </Field>
          <Field
            label="Consignatário"
            hint={manifestConsigneeDiverges
              ? `O último manifesto importado declara "${bl.manifest_customer_name}". A reimportação preserva o consignatário do B/L de propósito (dado comercial), então a divergência fica visível aqui em vez de sobrescrever em silêncio.`
              : undefined}
          >
            <Input value={form.consignee ?? ''} onChange={(event) => onFieldChange('consignee', event.target.value)} />
          </Field>
          <Field label="Notify Party">
            <Input
              value={form.notify_party ?? ''}
              onChange={(event) => onFieldChange('notify_party', event.target.value)}
            />
          </Field>
          <Field label="Notify 2">
            <Input disabled value={bl.notify2_block ?? ''} />
          </Field>
          <Field label="Telefone do consignatario">
            <Input disabled value={bl.consignee_phone ?? ''} />
          </Field>
          {/* Peso e cubagem de contêiner só aparecem quando há contêiner: desde
              as migrations 061 e 064 estas duas colunas medem exclusivamente a
              carga conteinerizada, e a carga solta tem as suas próprias acima.
              Num B/L misto os dois conjuntos aparecem e são independentes. */}
          {hasContainers ? (
            <>
              <Field label="Peso contêiner (kg)">
                <Input
                  type="number"
                  value={form.total_weight_kg ?? ''}
                  onChange={(event) => onFieldChange('total_weight_kg', event.target.value)}
                />
              </Field>
              <Field label="CBM contêiner (m³)">
                <Input
                  type="number"
                  value={form.total_cbm ?? ''}
                  onChange={(event) => onFieldChange('total_cbm', event.target.value)}
                />
              </Field>
            </>
          ) : null}

          <Field label="Pagamento">
            <Select
              value={form.payment_type ?? ''}
              onChange={(event) => onFieldChange('payment_type', event.target.value as BL['payment_type'])}
            >
              <option value="">Não informado</option>
              <option value="PREPAID">PREPAID</option>
              <option value="COLLECT">COLLECT</option>
            </Select>
          </Field>
          <Field label="Status de revisão">
            {/* Somente leitura: o status é derivado no servidor (save_bl_review →
                compute_bl_review_pendencies). Não é editável manualmente. */}
            <Input disabled value={REVIEW_STATUS_LABELS[bl.review_status ?? 'ok'] ?? bl.review_status ?? 'ok'} />
          </Field>
        </div>

        <div className="mt-4 grid gap-4">
          <Field
            label="NCM"
            hint="Códigos separados por vírgula. Campo próprio do B/L — necessário para a manifestação no Mercante e preservado quando o documento reimportado não declara NCM."
          >
            <Input
              placeholder="5509, 8703.80.00"
              value={form.ncm_codes}
              onChange={(event) => onFieldChange('ncm_codes', event.target.value)}
            />
            {ncmCadastrado.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {ncmCadastrado.map((ncm) => (
                  <span
                    key={ncm}
                    className="rounded-full border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs font-semibold text-slate-200"
                  >
                    {ncm}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-sm text-slate-400">Nenhum NCM cadastrado neste B/L.</div>
            )}
            {sugestaoAplicavel ? (
              <button
                type="button"
                className="mt-2 text-left text-xs text-[#58a6ff] hover:underline"
                onClick={() => onFieldChange('ncm_codes', ncmSugerido.join(', '))}
              >
                A descrição declara {ncmSugerido.join(', ')} — usar como NCM do B/L
              </button>
            ) : null}
          </Field>
          <Field label="Descrição da carga">
            <Textarea
              value={form.cargo_description ?? ''}
              onChange={(event) => onFieldChange('cargo_description', event.target.value)}
            />
          </Field>
          <Field label="Notas">
            <Textarea value={form.notes ?? ''} onChange={(event) => onFieldChange('notes', event.target.value)} />
          </Field>
          <Field label="Justificativa da alteração manual">
            <Textarea value={justification} onChange={(event) => onJustificationChange(event.target.value)} required />
          </Field>
        </div>

        <div className="mt-5 flex justify-end">
          <Button loading={saving} type="submit">
            <Save size={16} />
            Salvar alterações
          </Button>
        </div>
      </Card>
    </form>
  )
}

function StatusBadge({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'blue' | 'green' | 'red' | 'yellow' | 'slate'
}) {
  const resolvedTone =
    tone ??
    (value.includes('pending')
      ? 'yellow'
      : value.includes('paid') || value.includes('reviewed')
        ? 'green'
        : 'blue')

  return (
    <Badge tone={resolvedTone}>
      {label}: {value}
    </Badge>
  )
}
