import type { ReactNode } from 'react'
import { Block } from '../../ui/Block'
import { isPortalServicePort, normalizeInformationPort, portalServicePorts } from '../../../services/informationPort'
import type { PortalDepot, PortalInformation } from '../../../services/portalInformation'
import { DepotCards } from './DepotCards'
import { FilterRow } from './FilterRow'

function supportedDepots(depots: PortalDepot[]) {
  return depots.map(depot => ({
    ...depot,
    ports: depot.ports.map(port => normalizeInformationPort(port) ?? port).filter(isPortalServicePort),
  })).filter(depot => depot.ports.length > 0)
}

export function ReturnSection({ information, pod, filters }: { information: PortalInformation; pod: string; filters?: ReactNode }) {
  const publishedDepots = supportedDepots(information.depots).filter(
    (depot) => depot.active && depot.published
  )

  const activePort = pod ? (normalizeInformationPort(pod) ?? pod) : ''
  const ports = activePort ? portalServicePorts.filter((port) => port.code === activePort) : portalServicePorts

  // Um bloco por porto, em caixa normal; o depósito que atende mais de um
  // porto aparece em cada um deles.
  return (
    <div className="grid gap-4">
      <FilterRow note="Os containers descarregados num porto podem ser devolvidos em qualquer depósito desse porto.">{filters}</FilterRow>
      {ports.map((port) => {
        const portDepots = publishedDepots.filter((depot) => depot.ports.includes(port.code))
        return (
          <Block key={port.code} title={`${port.code} · ${port.name}`} aside={portDepots.length === 1 ? '1 depósito' : `${portDepots.length} depósitos`}>
            <DepotCards depots={portDepots} />
          </Block>
        )
      })}
    </div>
  )
}
