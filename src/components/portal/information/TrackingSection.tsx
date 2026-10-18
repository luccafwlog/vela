import { useSearchParams } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { Block } from '../../ui/Block'
import { Button } from '../../ui/Button'
import { EmptyState, InlineError } from '../../ui/Card'
import { Field, Select } from '../../ui/Input'
import { usePortalOperationBls } from '../../../hooks/usePortalOperation'
import { externalInformationUrl, trackingUrlForBl, trackingUrlHasBlMarker, type PortalInformation } from '../../../services/portalInformation'

/**
 * Tracking no site do armador (rodada 2): com a marca {BL} no link cadastrado,
 * o Cliente escolhe o B/L e o site abre já na consulta dele; sem a marca, só o
 * botão do armador, sem a escolha do B/L. Vale sempre o link vigente do
 * catálogo, não o que veio com o B/L.
 */
export function TrackingSection({ information }: { information: PortalInformation }) {
  const operation = usePortalOperationBls()
  const [params, setParams] = useSearchParams()
  const carriers = information.carriers.filter((carrier) => externalInformationUrl(carrier.tracking_url))
  const withBl = carriers.filter((carrier) => trackingUrlHasBlMarker(carrier.tracking_url))
  const withoutBl = carriers.filter((carrier) => !trackingUrlHasBlMarker(carrier.tracking_url))

  if (!carriers.length) return <EmptyState title="Sem links de tracking cadastrados" description="Consulte o atendimento para acompanhar seu B/L." />

  const bls = operation.error ? [] : (operation.data ?? []).filter((bl) => withBl.some((carrier) => carrier.carrier_id === bl.carrier_id))
  const selected = bls.find((bl) => bl.bl_id === params.get('bl')) ?? bls[0]
  const selectedCarrier = withBl.find((carrier) => carrier.carrier_id === selected?.carrier_id)
  const selectedUrl = selected && selectedCarrier ? trackingUrlForBl(selectedCarrier.tracking_url, selected.bl_id) : null

  return <div className="grid gap-4">
    {withBl.length > 0 && <Block title="Tracking no site do armador" aside="abre o site já na consulta do B/L">
      {operation.isLoading ? <p className="m-0 text-sm" role="status">Carregando seus B/Ls...</p> : operation.error ? <div className="grid justify-items-start gap-3"><InlineError message="Falha ao consultar seus B/Ls para tracking." /><Button variant="secondary" onClick={() => void operation.refetch()}>Tentar novamente</Button></div> : !bls.length ? <p className="m-0 text-sm text-[var(--app-muted)]">Nenhum B/L visível na sua operação.</p> : <>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-80">
            <Field label="B/L">
              <Select value={selected?.bl_id ?? ''} onChange={(event) => setParams((previous) => { const next = new URLSearchParams(previous); next.set('bl', event.target.value); return next })}>
                {bls.map((bl) => {
                  const voyage = [bl.vessel_name, bl.voyage_number].filter(Boolean).join(' / ')
                  return <option key={bl.bl_id} value={bl.bl_id}>{voyage ? `${bl.bl_id} · ${voyage}` : bl.bl_id}</option>
                })}
              </Select>
            </Field>
          </div>
          {selectedUrl && selectedCarrier ? <a href={selectedUrl} target="_blank" rel="noopener noreferrer" className="app-btn app-btn--primary">Ver tracking deste B/L na {selectedCarrier.name}<ExternalLink size={14} aria-hidden="true" /></a> : null}
        </div>
        <p className="m-0 text-sm text-[var(--app-muted)]">O link abre o site do armador com o número do B/L já preenchido na busca.</p>
      </>}
    </Block>}
    {withoutBl.length > 0 && <Block title={withBl.length > 0 ? 'Outros armadores' : 'Tracking no site do armador'}>
      <div className="flex flex-wrap gap-3">
        {withoutBl.map((carrier) => <a key={carrier.carrier_id} href={externalInformationUrl(carrier.tracking_url)!} target="_blank" rel="noopener noreferrer" className="app-btn app-btn--secondary">Abrir tracking da {carrier.name}<ExternalLink size={14} aria-hidden="true" /></a>)}
      </div>
      <p className="m-0 text-sm text-[var(--app-muted)]">O número do B/L se copia em BLs e Containers, pelo ícone de copiar ao lado dele.</p>
    </Block>}
  </div>
}
