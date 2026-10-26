import { Fact, FactList } from "../ui/Block";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { usePortalInformation } from "../../hooks/usePortalInformation";
import { BL_DELIVERY_ADDRESS_PENDING, BL_DELIVERY_AGENCIES, type PortalContact } from "../../services/portalInformation";

/**
 * Onde entregar o B/L original (ponto 6 de 2026-10-23): as agências de
 * Vitória, Salvador e Suape, como cadastradas no Vela na Central de
 * Informações (migrations 447 e 464). Abre pelo link "agência" do B/L
 * original; sem endereço informado, "Endereço a definir".
 */
export function CeUnlockDeliveryAddresses({ onClose }: { onClose: () => void }) {
  return (
    <Modal open size="sm" title="Onde entregar o B/L original" onClose={onClose}>
      <DeliveryAddresses />
    </Modal>
  );
}

function DeliveryAddresses() {
  const information = usePortalInformation();
  if (information.isLoading) return <p className="m-0 text-sm" role="status">Carregando os endereços…</p>;
  if (information.isError || !information.data) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm" role="alert">
        <span>Não foi possível carregar os endereços de entrega.</span>
        <Button variant="secondary" className="app-btn--sm" onClick={() => void information.refetch()}>Tentar novamente</Button>
      </div>
    );
  }
  const contacts = new Map(information.data.contacts.filter((contact) => contact.active).map((contact) => [contact.key, contact]));
  return (
    <FactList columns={1} className="gap-y-4">
      {BL_DELIVERY_AGENCIES.map((agency) => (
        <Fact key={agency.key} label={agency.port}>
          <DeliveryAddress contact={contacts.get(agency.key)} />
        </Fact>
      ))}
    </FactList>
  );
}

function DeliveryAddress({ contact }: { contact: PortalContact | undefined }) {
  const address = contact?.address?.trim() || BL_DELIVERY_ADDRESS_PENDING;
  const extras = [...(contact?.phones ?? []), ...(contact?.emails ?? [])];
  return (
    <span className="grid gap-1">
      <span className="whitespace-pre-line">{address}</span>
      {extras.map((extra) => <span key={extra}>{extra}</span>)}
    </span>
  );
}
