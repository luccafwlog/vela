import { Download } from 'lucide-react'
import { Field, Input } from '../ui/Input'
import {
  resolveVaziosManifestRoute,
  VAZIOS_IMPORTACAO_OPTIONAL_COLUMNS,
  VAZIOS_IMPORTACAO_REQUIRED_COLUMNS,
  type ParsedVaziosImportacaoManifest,
} from '../../services/vaziosImportacaoImport'

const TEMPLATE_BASE_NAME = 'vazios-importacao-modelo'

/** Campo do Nº de manifesto Mercante: obrigatório nos dois pontos de entrada da importação. */
export function VaziosImportacaoManifestNumberField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field
      label="Nº do manifesto Mercante"
      required
      hint="É o número que aparece na aba Rotas e Manifestos para a rota de vazios. Não pode repetir o de outro manifesto."
    >
      <Input inputMode="numeric" placeholder="Ex.: 1226501801342" value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

export function VaziosImportacaoGuide() {
  return (
    <div className="grid gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3 text-sm">
      <div>
        <span className="font-semibold text-[var(--app-text-strong)]">Colunas obrigatórias: </span>
        {VAZIOS_IMPORTACAO_REQUIRED_COLUMNS.join(', ')}.
      </div>
      <div className="text-[var(--app-muted)]">
        Opcionais: {VAZIOS_IMPORTACAO_OPTIONAL_COLUMNS.join(', ')}. POL e POD (código do porto, ex.: CNTAC, BRVIX) são
        obrigatórios porque o manifesto pertence à rota; use uma planilha por rota.
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

/** Mostra no preview a rota que receberá o manifesto, ou por que a planilha não pode ser importada. */
export function VaziosImportacaoRouteNotice({ manifest }: { manifest: Pick<ParsedVaziosImportacaoManifest, 'containers'> }) {
  const { route, error } = resolveVaziosManifestRoute(manifest)
  if (!manifest.containers.length) return null
  return route ? (
    <div className="app-panel app-panel--padded text-sm">
      Rota do manifesto: <span className="font-semibold text-[var(--app-text-strong)]">{route.pol} → {route.pod}</span>
    </div>
  ) : (
    <div role="alert" className="rounded-lg border border-[var(--app-gold)] bg-[var(--app-gold-soft)] p-3 text-xs text-[var(--app-gold-strong)]">
      <b>Importação bloqueada.</b> {error}
    </div>
  )
}
