import { Download } from 'lucide-react'
import { Field, Input } from '../ui/Input'
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
    <div className="grid gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3 text-sm">
      <div>
        <span className="font-semibold text-[var(--app-text-strong)]">Colunas obrigatórias: </span>
        {VAZIOS_IMPORTACAO_REQUIRED_COLUMNS.join(', ')}.
      </div>
      <div className="text-[var(--app-muted)]">
        Opcionais: {VAZIOS_IMPORTACAO_OPTIONAL_COLUMNS.join(', ')}. POL e POD (código do porto, ex.: CNTAC, BRVIX) são
        obrigatórios: depois de ler a planilha, informe um Nº de manifesto Mercante para cada porto de origem.
      </div>
      <div className="flex flex-wrap gap-2">
        {['xlsx', 'csv'].map((extension) => (
          <a
            key={extension}
            className="app-btn app-btn--secondary"
            href={`/templates/${TEMPLATE_BASE_NAME}.${extension}`}
            download={`${TEMPLATE_BASE_NAME}.${extension}`}
          >
            <Download size={16} />
            Baixar modelo .{extension}
          </a>
        ))}
      </div>
    </div>
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
      <div role="alert" className="rounded-lg border border-[var(--app-gold)] bg-[var(--app-gold-soft)] p-3 text-xs text-[var(--app-gold-strong)]">
        <b>Importação bloqueada.</b> {error}
      </div>
    )
  }
  // Campo vazio já aparece como obrigatório; o aviso cobre o que sobra (mesmo número em dois portos).
  const allFilled = routes.every((route) => (values[vaziosRouteKey(route)] ?? '').trim())
  const repeated = allFilled ? resolveVaziosManifestNumbers(manifest, values).error : null
  const countOf = (key: string) => manifest.containers.filter((c) => vaziosRouteKey({ pol: c.pol as string, pod: c.pod as string }) === key).length
  return (
    <div className="app-panel app-panel--padded grid gap-3">
      <div className="text-sm font-semibold text-[var(--app-text-strong)]">
        Nº do manifesto Mercante por porto de origem
      </div>
      {routes.map((route) => {
        const key = vaziosRouteKey(route)
        return (
          <Field
            key={key}
            label={`${route.pol} → ${route.pod} (${countOf(key)} container(s))`}
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
      {repeated ? <div role="alert" className="text-xs text-[var(--app-gold-strong)]">{repeated}</div> : null}
    </div>
  )
}
