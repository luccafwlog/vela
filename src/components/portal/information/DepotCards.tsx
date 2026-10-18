import { ExternalLink } from 'lucide-react'
import { Block, Fact, FactList } from '../../ui/Block'
import { CopyValue } from '../../ui/CopyValue'
import { useNarrowViewport } from '../../bl/useNarrowViewport'
import { externalInformationUrl, type PortalDepot } from '../../../services/portalInformation'

/**
 * Depósitos de um porto: cada um num bloco com o nome uma vez, os fatos
 * cadastrados e o agendamento no site do próprio depósito, quando houver link.
 */
export function DepotCards({ depots }: { depots: PortalDepot[] }) {
  // No celular os fatos ficam um embaixo do outro: endereço e instruções são longos.
  const narrow = useNarrowViewport()
  if (!depots.length) return <p className="m-0 text-sm text-[var(--app-muted)]">Sem depósitos disponíveis. Entre em contato com o atendimento para confirmar a devolução.</p>
  return <div className="grid gap-3 md:grid-cols-2">{depots.map((depot) => {
    const scheduling = externalInformationUrl(depot.scheduling_url)
    const facts = ([
      ['Endereço', depot.address],
      ['Horário', depot.opening_hours],
      ['Instruções', depot.instructions],
      ['Restrições', depot.restrictions],
    ] as const).filter(([, value]) => value?.trim())
    return <Block key={depot.id} title={depot.name} headingLevel={3}>
      <FactList columns={narrow ? 1 : 2}>
        {facts.map(([label, value]) => <Fact key={label} label={label} className="content-start"><span className="whitespace-pre-line">{value}</span></Fact>)}
        {depot.emails.length > 0 && <Fact className="content-start" label={depot.emails.length === 1 ? 'E-mail' : 'E-mails'}>
          <span className="grid gap-1">{depot.emails.map((email) => <span key={email}><CopyValue value={email} label="e-mail" /></span>)}</span>
        </Fact>}
        {depot.phones.length > 0 && <Fact className="content-start" label={depot.phones.length === 1 ? 'Telefone' : 'Telefones'}>
          <span className="grid gap-1">{depot.phones.map((phone) => <span key={phone}>{phone}</span>)}</span>
        </Fact>}
      </FactList>
      {scheduling && <div><a className="app-btn app-btn--secondary app-btn--sm" href={scheduling} target="_blank" rel="noopener noreferrer">Agendar no site do depósito<ExternalLink size={14} aria-hidden="true" /></a></div>}
    </Block>
  })}</div>
}
