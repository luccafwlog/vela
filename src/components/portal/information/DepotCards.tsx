import { Card, EmptyState } from '../../ui/Card'
import { externalInformationUrl, type PortalDepot } from '../../../services/portalInformation'

export function DepotCards({ depots }: { depots: PortalDepot[] }) {
  if (!depots.length) return <EmptyState title="Sem depots disponíveis" description="Entre em contato com o atendimento para confirmar a devolução." />
  return <div className="grid gap-4 md:grid-cols-2">{depots.map((depot) => {
    const scheduling = externalInformationUrl(depot.scheduling_url)
    return <Card key={depot.id}>
      <h3 className="text-base font-semibold">{depot.name}</h3>
      <p className="mt-1 text-sm text-[var(--app-muted)]">{depot.code} · {depot.ports.join(' / ')}</p>
      <dl className="mt-4 grid gap-3 text-sm">
        {[["Endereço", depot.address], ["Horário de atendimento", depot.opening_hours], ["Instruções", depot.instructions], ["Restrições", depot.restrictions]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-line text-[var(--app-muted)]">{value}</dd></div>)}
        {depot.emails.length > 0 && <div><dt className="font-medium">Email</dt><dd className="break-words">{depot.emails.join(' / ')}</dd></div>}
        {depot.phones.length > 0 && <div><dt className="font-medium">Telefone</dt><dd>{depot.phones.join(' / ')}</dd></div>}
      </dl>
      {scheduling && <a className="mt-4 inline-block text-sm font-medium text-[var(--app-link)] underline" href={scheduling} target="_blank" rel="noopener noreferrer">Abrir agendamento</a>}
    </Card>
  })}</div>
}
