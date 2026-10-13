import { useSearchParams } from 'react-router-dom'
import { Button } from '../../ui/Button'
import { CopyValue } from '../../ui/CopyValue'
import { Card, EmptyState, InlineError } from '../../ui/Card'
import { Field, Select } from '../../ui/Input'
import { usePortalOperationBls } from '../../../hooks/usePortalOperation'
import { externalInformationUrl, type PortalInformation } from '../../../services/portalInformation'

export function TrackingSection({ information }: { information: PortalInformation }) {
  const operation = usePortalOperationBls()
  const [params, setParams] = useSearchParams()
  const selected = operation.error ? undefined : (operation.data ?? []).find((bl) => bl.bl_id === params.get('bl'))
  const tracking = externalInformationUrl(information.carriers.find((carrier) => carrier.carrier_id === selected?.carrier_id)?.tracking_url)
  return <div className="grid gap-4">
    <Card><h2 className="text-base font-semibold">Tracking do armador</h2><p className="my-3 text-sm text-[var(--app-muted)]">Copie o número do B/L e consulte o site oficial do armador.</p>
      {operation.isLoading ? <p role="status">Carregando seus B/Ls...</p> : operation.error ? <><InlineError message="Falha ao consultar seus B/Ls para tracking." /><Button className="mt-3" variant="secondary" onClick={() => void operation.refetch()}>Tentar novamente</Button></> : !operation.data?.length ? <p className="text-sm text-[var(--app-muted)]">Nenhum B/L visível na sua operação.</p> : <Field label="B/L da operação"><Select value={selected?.bl_id ?? ''} onChange={(event) => { setParams((previous) => { const next = new URLSearchParams(previous); if (event.target.value) next.set('bl', event.target.value); else next.delete('bl'); return next }) }}><option value="">Selecione um B/L</option>{(operation.data ?? []).map((bl) => <option key={bl.bl_id} value={bl.bl_id}>{bl.bl_id}{bl.carrier_name ? ` · ${bl.carrier_name}` : ''}</option>)}</Select></Field>}
      {selected && <div className="mt-4"><p className="mb-3 break-all text-sm">B/L <CopyValue value={selected.bl_id} label="número do B/L" /></p><div className="flex flex-wrap items-center gap-3">{tracking ? <a href={tracking} target="_blank" rel="noopener noreferrer" className="app-btn app-btn--secondary app-btn--sm">Abrir tracking do armador</a> : <span className="text-sm text-[var(--app-muted)]">Tracking não cadastrado para este armador.</span>}</div></div>}
    </Card>
    {!information.carriers.some((carrier) => externalInformationUrl(carrier.tracking_url)) ? <EmptyState title="Sem links de tracking cadastrados" /> : <div className="grid gap-4 md:grid-cols-2">{information.carriers.map((carrier) => {
      const url = externalInformationUrl(carrier.tracking_url)
      return url && <Card key={carrier.carrier_id}><h3 className="font-semibold">{carrier.name}</h3><a href={url} target="_blank" rel="noopener noreferrer" className="app-btn app-btn--secondary app-btn--sm mt-3">Abrir tracking de {carrier.name}</a></Card>
    })}</div>}
  </div>
}
