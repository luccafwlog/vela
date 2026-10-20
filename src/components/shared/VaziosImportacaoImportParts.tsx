import { Field, Input } from '../ui/Input'
import { ImportGuide, ImportNotice, ImportSection, ImportTemplateLinks } from './ImportParts'
import { plural } from './importPresentation'
import {
  resolveVaziosManifestNumbers,
  resolveVaziosManifestRoutes,
  vaziosRouteKey,
  VAZIOS_IMPORTACAO_OPTIONAL_COLUMNS,
  VAZIOS_IMPORTACAO_REQUIRED_COLUMNS,
  type ParsedVaziosImportacaoManifest,
} from '../../services/vaziosImportacaoImport'

const TEMPLATE_BASE_NAME = 'vazios-importacao-modelo'

/** Modelos da planilha de vazios de importação, na faixa do bloco Arquivo. */
export function VaziosImportacaoTemplates() {
  return <ImportTemplateLinks baseName={TEMPLATE_BASE_NAME} />
}

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
    />
  )
}

type ManifestNumbersProps = {
  manifest: Pick<ParsedVaziosImportacaoManifest, 'containers'>
  values: Readonly<Record<string, string>>
  onChange: (values: Record<string, string>) => void
  disabled?: boolean
}

/**
 * Um campo de Nº do manifesto Mercante por rota (POL → POD) da planilha. É o
 * número que a aba Rotas e Manifestos mostra na linha VAZIOS.
 */
export function VaziosImportacaoManifestNumbers({ manifest, values, onChange, disabled = false }: ManifestNumbersProps) {
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
  const title = 'Nº do manifesto Mercante por rota (POL → POD)'
  return (
    <ImportSection title={title} aside={plural(routes.length, 'rota', 'rotas')}>
      <fieldset className="grid gap-3" disabled={disabled}>
        <legend className="sr-only">{title}</legend>
        {routes.map((route) => {
          const key = vaziosRouteKey(route)
          return (
            <Field
              key={key}
              label={`${route.pol} → ${route.pod} · ${plural(countOf(key), 'container', 'containers')}`}
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
    </ImportSection>
  )
}
