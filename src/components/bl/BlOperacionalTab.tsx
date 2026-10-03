import { useMemo, type FormEvent, type ReactNode } from 'react'
import { Save } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input, Select, Textarea } from '../ui/Input'
import type { BlForm } from '../../hooks/useBlEditForm'
import type { CargoMode } from '../../pages/blDetalheHelpers'
import { formatNcm, listBlNcms } from '../../lib/ncm'
import { normalizeText } from '../../lib/utils'
import { parseNcmInput } from '../../hooks/useBlEditForm'
import { REVIEW_STATUS_LABELS } from '../../lib/statusLabels'
import type { BL, BLDetail } from '../../types/database'

// Formulário de edição manual do B/L. O pai (BlDetalhe) mantém o estado do
// form. Modalidade, navio/viagem e situação de taxas não se repetem aqui: já
// estão no cabeçalho, na Visão Geral e na aba Faturamento.
export function BlOperacionalTab({
  active,
  bl,
  form,
  changes,
  saving,
  justification,
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

  const reviewLabel = REVIEW_STATUS_LABELS[bl.review_status ?? 'ok'] ?? bl.review_status ?? 'ok'
  const number = (field: keyof BlForm, label: string) => (
    <Field label={label}>
      <Input type="number" value={(form[field] as string | number | null) ?? ''} onChange={(event) => onFieldChange(field, event.target.value)} />
    </Field>
  )
  const text = (field: keyof BlForm, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input value={(form[field] as string | null) ?? ''} onChange={(event) => onFieldChange(field, event.target.value)} />
    </Field>
  )

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">Dados do B/L</h2>
          <Badge tone={bl.review_status === 'pending_review' ? 'yellow' : 'green'}>Revisão: {reviewLabel}</Badge>
        </div>

        <div className="grid gap-6">
          <Section title="Partes">
            <div className="grid gap-4 md:grid-cols-2">
              {text('shipper', 'Shipper')}
              <Field
                label="Consignatário"
                hint={manifestConsigneeDiverges
                  ? `O último manifesto importado declara "${bl.manifest_customer_name}". A reimportação preserva o consignatário do B/L de propósito (dado comercial), então a divergência fica visível aqui em vez de sobrescrever em silêncio.`
                  : undefined}
              >
                <Input value={form.consignee ?? ''} onChange={(event) => onFieldChange('consignee', event.target.value)} />
              </Field>
              {text('notify_party', 'Notify Party')}
              <Field label="Notify 2">
                <Input disabled value={bl.notify2_block ?? ''} />
              </Field>
              <Field label="Telefone do consignatário">
                <Input disabled value={bl.consignee_phone ?? ''} />
              </Field>
            </div>
          </Section>

          <Section title="Rota">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {text('place_of_receipt', 'Place of Receipt')}
              {text('pol', 'POL')}
              {text('pod', 'POD')}
              {text('place_of_delivery', 'Place of Delivery')}
              {text('movement_from', 'Movement From')}
              {text('movement_to', 'Movement To', 'Contendo LCL ou CFS, isenta veículo de taxa local no destino.')}
            </div>
          </Section>

          <Section title="Documento">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Data de emissão">
                <Input type="date" value={(form.bl_emission_date ?? '').slice(0, 10)} onChange={(event) => onFieldChange('bl_emission_date', event.target.value)} />
              </Field>
              {text('issue_place', 'Local de emissão')}
              {text('ce_mercante', 'CE Mercante')}
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
            </div>
          </Section>

          <Section title="Carga">
            {/* Peso e cubagem de contêiner só existem quando há contêiner: desde
                as migrations 061 e 064 essas colunas medem só a carga
                conteinerizada; a carga solta tem as suas. No B/L misto os dois
                conjuntos aparecem e são independentes. */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {!isContainerMode ? (
                <>
                  {number('bb_machine_qty', 'Máquinas')}
                  {number('bb_packages_qty', 'Packages')}
                  {number('bb_packages_total', 'Packages total')}
                  {number('bb_weight_ton', 'Peso (t)')}
                  {number('bb_cbm', 'CBM carga solta (m³)')}
                </>
              ) : null}
              {hasContainers ? (
                <>
                  {number('total_weight_kg', 'Peso contêiner (kg)')}
                  {number('total_cbm', 'CBM contêiner (m³)')}
                </>
              ) : null}
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Field
                label="NCM"
                hint="Códigos separados por vírgula. Exigido na manifestação no Mercante e preservado quando o documento reimportado não declara NCM."
              >
                <Input
                  placeholder="5509, 8703.80.00"
                  value={form.ncm_codes}
                  onChange={(event) => onFieldChange('ncm_codes', event.target.value)}
                />
                {ncmCadastrado.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ncmCadastrado.map((ncm) => <Badge key={ncm} tone="slate">{ncm}</Badge>)}
                  </div>
                ) : null}
                {sugestaoAplicavel ? (
                  <button
                    type="button"
                    className="mt-2 text-left text-xs text-[var(--app-link)] hover:underline"
                    onClick={() => onFieldChange('ncm_codes', ncmSugerido.join(', '))}
                  >
                    A descrição declara {ncmSugerido.join(', ')} — usar como NCM do B/L
                  </button>
                ) : null}
              </Field>
              <Field label="Descrição da carga">
                <Textarea
                  rows={4}
                  value={form.cargo_description ?? ''}
                  onChange={(event) => onFieldChange('cargo_description', event.target.value)}
                />
              </Field>
            </div>
          </Section>

          <Section title="Notas">
            <Textarea
              aria-label="Notas"
              rows={2}
              value={form.notes ?? ''}
              onChange={(event) => onFieldChange('notes', event.target.value)}
            />
          </Section>
        </div>

        <div className="mt-6 grid gap-3 border-t border-[var(--app-border)] pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <Field label="Justificativa da alteração" hint="Obrigatória. Fica no histórico com o autor.">
            <Input
              value={justification}
              onChange={(event) => onJustificationChange(event.target.value)}
              required
            />
          </Field>
          <div className="flex items-center gap-3">
            {changes.length ? (
              <span className="text-sm text-[var(--app-muted)]">
                {changes.length} {changes.length === 1 ? 'campo alterado' : 'campos alterados'}
              </span>
            ) : null}
            <Button loading={saving} type="submit" disabled={!changes.length}>
              <Save size={16} />
              Salvar alterações
            </Button>
          </div>
        </div>
      </Card>
    </form>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--app-muted)]">{title}</h3>
      {children}
    </section>
  )
}
