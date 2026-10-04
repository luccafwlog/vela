import { Card, EmptyState } from '../../ui/Card'
import { externalInformationUrl, type PortalInformation } from '../../../services/portalInformation'

export function AgentsSection({ information, pod }: { information: PortalInformation; pod: string }) {
  const agents = information.agents.filter((agent) => agent.active && (!pod || agent.ports.includes(pod)))
  if (!agents.length) return <EmptyState title="Sem agentes cadastrados" description="Consulte o atendimento para informações deste porto." />
  return <div className="grid gap-4 md:grid-cols-2">{agents.map((agent) => <Card key={agent.id}><h2 className="font-semibold">{agent.name}</h2><p className="mt-2 text-sm text-[var(--app-muted)]">{agent.ports.join(' / ')}</p><p className="mt-3 break-words text-sm">{agent.emails.join(' / ') || 'Email não cadastrado'}</p></Card>)}</div>
}

export function ContactsSection({ information }: { information: PortalInformation }) {
  const contacts = information.contacts.filter((contact) => contact.active)
  if (!contacts.length) return <EmptyState title="Atendimento indisponível" description="Nenhum canal de atendimento publicado no momento." />
  return <div className="grid gap-4 md:grid-cols-2">{contacts.map((contact) => {
    const whatsapp = externalInformationUrl(contact.whatsapp)
    return <Card key={contact.key}><h2 className="font-semibold">{contact.title}</h2>{contact.description && <p className="mt-2 whitespace-pre-line text-sm text-[var(--app-muted)]">{contact.description}</p>}<dl className="mt-4 grid gap-3 text-sm">{contact.emails.length > 0 && <div><dt className="font-medium">Email</dt><dd className="break-words">{contact.emails.join(' / ')}</dd></div>}{contact.phones.length > 0 && <div><dt className="font-medium">Telefone</dt><dd>{contact.phones.join(' / ')}</dd></div>}{contact.address && <div><dt className="font-medium">Endereço</dt><dd>{contact.address}</dd></div>}</dl>{whatsapp && <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-sm text-[var(--app-link)] underline">Abrir WhatsApp</a>}</Card>
  })}</div>
}
