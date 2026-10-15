import { useMemo, type FormEvent } from 'react'
import { Save } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Block, Fact, FactList } from '../ui/Block'
import { NoValue } from '../ui/NoValue'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { BlCeMercanteField } from './BlCeMercanteField'
import { BlManifestoField } from './BlManifestoField'
import type { BlForm } from '../../hooks/useBlEditForm'
import type { CargoMode } from '../../pages/blDetalheHelpers'
import { formatNcm, listBlNcms } from '../../lib/ncm'
import { normalizeText } from '../../lib/utils'
import { parseNcmInput } from '../../hooks/useBlEditForm'
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

  const cancelled = Boolean((bl as BLDetail & { cancelled_at?: string | null }).cancelled_at)
  const carga = (
    <>
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
    </>
  )

  return (
    <>
      {/* CE e Manifesto têm a sua ação e o seu motivo: não entram no Salvar. */}
      <Block title="Documento Mercante" aside="Cada um se corrige com o seu motivo; não entra no Salvar alterações">
        <div className="grid gap-5 md:grid-cols-2">
          <BlCeMercanteField blId={bl.id} voyageId={bl.voyage_id} ce={bl.ce_mercante} disabled={cancelled} />
          <BlManifestoField
            blId={bl.id}
            voyageId={bl.voyage_id}
            numero={(bl as BLDetail & { manifesto_mercante?: { numero?: string | null } | null }).manifesto_mercante?.numero ?? null}
            disabled={cancelled}
          />
        </div>
      </Block>

      <form onSubmit={onSubmit} className="grid gap-5">
        <Block title="Partes">
          <div className="grid gap-4 md:grid-cols-3">
            {text('shipper', 'Shipper')}
            <Field
              label="Consignatário"
              hint={manifestConsigneeDiverges
                ? `O último manifesto declara "${bl.manifest_customer_name}". A reimportação não sobrescreve o consignatário do B/L.`
                : undefined}
            >
              <Input value={form.consignee ?? ''} onChange={(event) => onFieldChange('consignee', event.target.value)} />
            </Field>
            {text('notify_party', 'Notify Party')}
          </div>
          {/* Vêm só do documento importado: dado, não campo editável. */}
          <FactList columns={4}>
            <Fact label="Notify 2 · do arquivo">{bl.notify2_block || <NoValue label="Sem Notify 2" />}</Fact>
            <Fact label="Telefone do consignatário · do arquivo">{bl.consignee_phone || <NoValue label="Sem telefone" />}</Fact>
          </FactList>
        </Block>

        <Block title="Rota">
          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
            {text('place_of_receipt', 'Place of Receipt')}
            {text('pol', 'POL')}
            {text('pod', 'POD')}
            {text('place_of_delivery', 'Place of Delivery')}
            {text('movement_from', 'Movement From')}
            {text('movement_to', 'Movement To')}
          </div>
          <p className="app-field__hint">Movement To com LCL ou CFS isenta o veículo da taxa local no destino.</p>
        </Block>

        <Block title="Emissão e pagamento">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Data de emissão">
              <Input type="date" value={(form.bl_emission_date ?? '').slice(0, 10)} onChange={(event) => onFieldChange('bl_emission_date', event.target.value)} />
            </Field>
            {text('issue_place', 'Local de emissão')}
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
        </Block>

        <Block title="Carga declarada">
          {/* Peso e cubagem de contêiner só existem quando há contêiner: desde
              as migrations 061 e 064 essas colunas medem só a carga
              conteinerizada; a carga solta tem as suas. No B/L misto os dois
              conjuntos aparecem e são independentes. */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
              {carga}
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
                    {ncmCadastrado.map((ncm) => <Badge key={ncm} tone="neutral">{ncm}</Badge>)}
                  </div>
                ) : null}
                {sugestaoAplicavel ? (
                  <Button type="button" variant="ghost" className="app-btn--sm mt-2" onClick={() => onFieldChange('ncm_codes', ncmSugerido.join(', '))}>
                    Usar {ncmSugerido.join(', ')}, que a descrição declara, como NCM do B/L
                  </Button>
                ) : null}
              </Field>
            </div>
            {/* No B/L a descrição costuma ser um bloco vertical longo. */}
            <Field label="Descrição da carga">
              <Textarea
                rows={10}
                value={form.cargo_description ?? ''}
                onChange={(event) => onFieldChange('cargo_description', event.target.value)}
              />
            </Field>
          </div>
        </Block>

        <Block title="Notas">
          <Textarea
            aria-label="Notas"
            rows={2}
            // Notas é campo de uso raro: duas linhas, sem a altura mínima do textarea comum.
            style={{ minHeight: 0 }}
            value={form.notes ?? ''}
            onChange={(event) => onFieldChange('notes', event.target.value)}
          />
        </Block>

        <div className={`app-bl-savebar${changes.length ? ' app-bl-savebar--dirty' : ''}`}>
          <Field label="Justificativa da alteração" required hint="Fica no histórico com o autor.">
            <Input
              value={justification}
              onChange={(event) => onJustificationChange(event.target.value)}
              required
            />
          </Field>
          <div className="flex items-center gap-3">
            <span className="app-facts__detail" aria-live="polite">
              {changes.length ? `${changes.length} ${changes.length === 1 ? 'campo alterado' : 'campos alterados'}` : 'Nenhuma alteração'}
            </span>
            <Button loading={saving} loadingLabel="Salvando…" type="submit" disabled={!changes.length}>
              <Save size={16} aria-hidden="true" />
              Salvar alterações
            </Button>
          </div>
        </div>
      </form>
    </>
  )
}
