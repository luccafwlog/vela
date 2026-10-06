import { Card, EmptyState } from '../../ui/Card'
import { isPortalServicePort, normalizeInformationPort, portalServicePorts } from '../../../services/informationPort'
import type { PortalDepot, PortalInformation } from '../../../services/portalInformation'
import { DepotCards } from './DepotCards'

function supportedDepots(depots: PortalDepot[]) {
  return depots.map(depot => ({
    ...depot,
    ports: depot.ports.map(port => normalizeInformationPort(port) ?? port).filter(isPortalServicePort),
  })).filter(depot => depot.ports.length > 0)
}

export function ReturnSection({ information, pod }: { information: PortalInformation; pod: string }) {
  const publishedDepots = supportedDepots(information.depots).filter(
    (depot) => depot.active && depot.published
  )

  const activePort = pod ? (normalizeInformationPort(pod) ?? pod) : ''

  return (
    <div className="grid gap-4">
      <Card>
        <h2 className="text-base font-semibold">Depósitos para devolução</h2>
        <p className="mt-2 text-sm text-[var(--app-muted)]">
          Os containers descarregados em um porto podem ser devolvidos em qualquer depósito disponível desse porto.
          Confira endereço, horário de atendimento, restrições e agendamento antes da entrega.
        </p>
      </Card>

      {activePort ? (
        <DepotCards
          depots={publishedDepots.filter((depot) => depot.ports.includes(activePort))}
        />
      ) : (
        portalServicePorts.map((port) => {
          const portDepots = publishedDepots.filter((depot) => depot.ports.includes(port.code))
          return (
            <section key={port.code} className="grid gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--app-muted)]">
                {port.code} · {port.name}
              </h3>
              {portDepots.length > 0 ? (
                <DepotCards depots={portDepots} />
              ) : (
                <EmptyState
                  title="Sem depósitos disponíveis"
                  description="Entre em contato com o atendimento para confirmar a devolução."
                />
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
