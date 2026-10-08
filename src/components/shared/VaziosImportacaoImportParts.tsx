import { Field, Input } from '../ui/Input'
import { ImportGuide, ImportNotice, ImportTemplateLinks } from './ImportParts'
import {
  resolveVaziosManifestNumbers,
  resolveVaziosManifestRoutes,
  vaziosRouteKey,
  VAZIOS_IMPORTACAO_OPTIONAL_COLUMNS,
  VAZIOS_IMPORTACAO_REQUIRED_COLUMNS,
  type ParsedVaziosImportacaoManifest,
} from '../../services/vaziosImportacaoImport'

const TEMPLATE_BASE_NAME = 'vazios-importacao-modelo'

export function VaziosImportacaoGuide() {
  return (
    <ImportGuide
      required={<>{VAZIOS_IMPORTACAO_REQUIRED_COLUMNS.join(', ')}.</>}
      optional={<>{VAZIOS_IMPORTACAO_OPTIONAL_COLUMNS.join(', ')}.</>}
      details={
        <p>
          POL e POD usam o código do porto (ex.: CNTAC, BRVIX). Depois da leitura, informe um Nº de manifesto
          Mercante para cada porto de origem.
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
 * Um campo de Nº do manifesto Mercante por porto de origem (rota POL → POD) da
 * planilha. É o número que a aba Rotas e Manifestos mostra na linha VAZIOS.
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
  // Campo vazio já aparece como obrigatório; o aviso cobre o que sobra (mesmo número em dois portos).
  const allFilled = routes.every((route) => (values[vaziosRouteKey(route)] ?? '').trim())
  const repeated = allFilled ? resolveVaziosManifestNumbers(manifest, values).error : null
  const countOf = (key: string) => manifest.containers.filter((c) => vaziosRouteKey({ pol: c.pol as string, pod: c.pod as string }) === key).length
  return (
    <fieldset className="app-import-section grid gap-3 border-x-0 border-b-0 p-0 pt-3">
      <legend className="app-import-section__title float-left mb-1 w-full">
        Nº do manifesto Mercante por porto de origem
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
