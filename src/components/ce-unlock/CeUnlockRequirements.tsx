import type { CeUnlockItem } from "../../types/ceUnlock";
export function CeUnlockRequirements({
  item,
}: {
  item: Pick<
    CeUnlockItem,
    "source" | "termo" | "procuracao" | "paid" | "delivered"
  >;
}) {
  const approved =
    item.source === "vip_annual" ? "Aprovado — anual VIP" : "Aprovado";
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      <div>
        <dt>Termo</dt>
        <dd>{item.termo ? approved : "Pendente"}</dd>
      </div>
      <div>
        <dt>Procuração</dt>
        <dd>{item.procuracao ? approved : "Pendente"}</dd>
      </div>
      <div>
        <dt>Taxas locais</dt>
        <dd>{item.paid ? "Pagamento confirmado" : "Pagamento pendente"}</dd>
      </div>
      <div>
        <dt>BL físico</dt>
        <dd>{item.delivered ? "Entregue" : "Aguardando entrega"}</dd>
      </div>
    </dl>
  );
}
