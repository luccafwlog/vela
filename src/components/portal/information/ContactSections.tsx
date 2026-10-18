import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { Block, Fact, FactList, LeadValue } from '../../ui/Block'
import { EmptyState } from '../../ui/Card'
import { CopyValue } from '../../ui/CopyValue'
import { NoValue } from '../../ui/NoValue'
import { useNarrowViewport } from '../../bl/useNarrowViewport'
import { externalInformationUrl, type PortalContact, type PortalInformation } from '../../../services/portalInformation'
import { FilterRow } from './FilterRow'

export function AgentsSection({ information, pod, filters }: { information: PortalInformation; pod: string; filters?: ReactNode }) {
  const agents = information.agents.filter((agent) => agent.active && (!pod || agent.ports.includes(pod)))
  return <div className="grid gap-4">
    <FilterRow>{filters}</FilterRow>
    {!agents.length ? <EmptyState title="Sem agentes cadastrados" description="Consulte o atendimento para informações deste porto." /> : <Block title="Agentes" aside={agents.length} flush>
      <div className="app-table-scroll"><table className="app-table app-table--compact text-sm"><caption className="sr-only">Agentes por porto</caption><thead><tr>
        <th scope="col" className="app-table__text-head">Agente</th>
        <th scope="col" className="app-table__text-head">Portos</th>
        <th scope="col" className="app-table__text-head">E-mails</th>
      </tr></thead><tbody>{agents.map((agent) => <tr key={agent.id}>
        <td className="app-table__text font-semibold" title={agent.name}>{agent.name}</td>
        <td className="app-table__text app-table__text--wrap">{agent.ports.join(' · ')}</td>
        {/* Os e-mails quebram linha quando não cabem; cada um com copiar. */}
        <td className="app-table__text app-table__text--wrap">{agent.emails.length ? <span className="flex flex-wrap gap-x-3 gap-y-1">{agent.emails.map((email) => <CopyValue key={email} value={email} label="e-mail" />)}</span> : <NoValue label="E-mail não cadastrado" />}</td>
      </tr>)}</tbody></table></div>
    </Block>}
  </div>
}

// Importação primeiro: é o assunto do Portal.
function contactOrder(contacts: PortalContact[]) {
  return [...contacts].sort((a, b) => Number(b.key === 'importacao') - Number(a.key === 'importacao'))
}

export function ContactsSection({ information }: { information: PortalInformation }) {
  const contacts = contactOrder(information.contacts.filter((contact) => contact.active))
  const narrow = useNarrowViewport()
  if (!contacts.length) return <EmptyState title="Contato indisponível" description="Nenhum canal de atendimento publicado no momento." />
  return <div className="grid items-start gap-4 md:grid-cols-2">{contacts.map((contact) => {
    const whatsapp = externalInformationUrl(contact.whatsapp)
    const hasFacts = contact.phones.length > 0 || Boolean(contact.address)
    return <Block key={contact.key} title={contact.title}>
      {/* O e-mail é o dado principal, com copiar: o link de e-mail nem sempre
          abre no computador do Cliente. */}
      {contact.emails.length > 0 ? <LeadValue>{contact.emails.map((email) => <span key={email} className="block"><CopyValue value={email} label="e-mail" /></span>)}</LeadValue> : null}
      {contact.description ? <p className="m-0 whitespace-pre-line text-sm text-[var(--app-muted)]">{contact.description}</p> : null}
      {hasFacts ? <FactList columns={narrow ? 1 : 2}>
        {contact.phones.length > 0 ? <Fact className="content-start" label={contact.phones.length === 1 ? 'Telefone' : 'Telefones'}><span className="grid gap-1">{contact.phones.map((phone) => <span key={phone}>{phone}</span>)}</span></Fact> : null}
        {contact.address ? <Fact className="content-start" label="Endereço">{contact.address}</Fact> : null}
      </FactList> : null}
      {whatsapp && <div><a href={whatsapp} target="_blank" rel="noopener noreferrer" className="app-btn app-btn--secondary app-btn--sm">Abrir WhatsApp<ExternalLink size={14} aria-hidden="true" /></a></div>}
    </Block>
  })}</div>
}
