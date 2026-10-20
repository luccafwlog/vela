import { Field, Input } from '../ui/Input'
import { NoValue } from '../ui/NoValue'
import { SummaryStrip } from '../ui/SummaryStrip'
import { ImportGuide, ImportNotice, ImportSection, ImportTemplateLinks } from './ImportParts'
import { TruncationNote } from './TruncationNote'
import {
  resolveVaziosManifestNumbers,
  resolveVaziosManifestRoutes,
  vaziosRouteKey,
  VAZIOS_IMPORTACAO_OPTIONAL_COLUMNS,
  VAZIOS_IMPORTACAO_REQUIRED_COLUMNS,
  type ParsedVaziosImportacaoManifest,
} from '../../services/vaziosImportacaoImport'

const TEMPLATE_BASE_NAME = 'vazios-importacao-modelo'
const PREVIEW_ROWS = 25

export function VaziosImportacaoGuide() {
  return (
    <ImportGuide
      required={<>{VAZIOS_IMPORTACAO_REQUIRED_COLUMNS.join(', ')}.</>}
      optional={<>{VAZIOS_IMPORTACAO_OPTIONAL_COLUMNS.join(', ')}.</>}
      details={
        <p>
          POL e POD usam o código do porto (ex.: CNTAC, BRVIX). Depois da leitura, informe um Nº de manifesto
          Mercante para cada rota (POL → POD): o mesmo POL com dois POD pede dois números.
        </p>
      }
      templates={<ImportTemplateLinks baseName={TEMPLATE_BASE_NAME} />}
    />
  )
}

type ManifestNumbersProps = {
  manifest: Pick<ParsedVaziosImportacaoManifest, 'containers'>
  values: Readonly<Record<string, string>>
  onChange: (values: Record<string, string>) => void
}

/**
 * Um campo de Nº do manifesto Mercante por rota (POL → POD) da planilha. É o
 * número que a aba Rotas e Manifestos mostra na linha VAZIOS.
 */
export function VaziosImportacaoManifestNumbers({ manifest, values, onChange }: ManifestNumbersProps) {
  const { routes, error } = resolveVaziosManifestRoutes(manifest)
  if (!manifest.containers.length) return null
  if (!routes) {
    return (
      <ImportNotice tone="danger" role="alert" title="Importação bloqueada">
        <p>{error}</p>
        <p>Corrija POL e POD na planilha e escolha o arquivo de novo.</p>
      </ImportNotice>
    )
  }
  // Campo vazio já aparece como obrigatório; o aviso cobre o que sobra (mesmo número em duas rotas).
  const allFilled = routes.every((route) => (values[vaziosRouteKey(route)] ?? '').trim())
  const repeated = allFilled ? resolveVaziosManifestNumbers(manifest, values).error : null
  const countOf = (key: string) => manifest.containers.filter((c) => vaziosRouteKey({ pol: c.pol as string, pod: c.pod as string }) === key).length
  return (
    <fieldset className="app-import-section grid gap-3 border-x-0 border-b-0 p-0 pt-3">
      <legend className="app-import-section__title float-left mb-1 w-full">
        Nº do manifesto Mercante por rota (POL → POD)
      </legend>
      {routes.map((route) => {
        const key = vaziosRouteKey(route)
        return (
          <Field
            key={key}
            label={`${route.pol} → ${route.pod} · ${countOf(key)} ${countOf(key) === 1 ? 'container' : 'containers'}`}
            required
            hint="Não pode repetir o número de outro manifesto."
          >
            <Input
              inputMode="numeric"
              placeholder="Ex.: 1226501801342"
              value={values[key] ?? ''}
              onChange={(event) => onChange({ ...values, [key]: event.target.value })}
            />
          </Field>
        )
      })}
      {repeated ? <p role="alert" className="app-field__error">{repeated}</p> : null}
    </fieldset>
  )
}

/** Prévia da planilha na janela de importação: resumo, primeiras linhas e os números por rota. */
export function VaziosImportacaoPreview({
  manifest,
  manifestNumbers,
  onManifestNumbersChange,
}: {
  manifest: ParsedVaziosImportacaoManifest
  manifestNumbers: Record<string, string>
  onManifestNumbersChange: (values: Record<string, string>) => void
}) {
  const warnings = manifest.rowErrors.length
  return (
    <div className="grid gap-4">
      <SummaryStrip
        label="Resumo da planilha"
        items={[
          { label: 'Containers válidos', value: manifest.containers.length.toLocaleString('pt-BR') },
          { label: warnings === 1 ? 'Aviso' : 'Avisos', value: warnings.toLocaleString('pt-BR'), tone: warnings ? 'warning' : 'default' },
        ]}
      />
      <ImportSection title="Containers lidos">
        <div className="app-table-scroll max-h-64">
          <table className="app-table app-table--compact">
            <caption className="sr-only">Prévia dos containers vazios da planilha</caption>
            <thead>
              <tr>
                <th scope="col">Container</th>
                <th scope="col">Tipo</th>
                <th scope="col">Tara</th>
                <th scope="col">Trecho</th>
              </tr>
            </thead>
            <tbody>
              {manifest.containers.slice(0, PREVIEW_ROWS).map((container, index) => (
                <tr key={`${container.container_number}-${index}`}>
                  <td className="font-[var(--app-font-mono)]">{container.container_number}</td>
                  <td>{container.container_type ?? <NoValue label="Sem tipo" />}</td>
                  <td className="tabular-nums">{container.tare_kg != null ? `${Number(container.tare_kg).toLocaleString('pt-BR')} kg` : <NoValue label="Sem tara" />}</td>
                  <td>{container.pol && container.pod ? `${container.pol} → ${container.pod}` : <NoValue label="Sem POL ou POD" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TruncationNote shown={PREVIEW_ROWS} total={manifest.containers.length} noun="container" nounPlural="containers" />
      </ImportSection>
      <VaziosImportacaoManifestNumbers manifest={manifest} values={manifestNumbers} onChange={onManifestNumbersChange} />
    </div>
  )
}
