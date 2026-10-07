import { CheckCircle2, Circle } from "lucide-react";
import type { CeUnlockItem } from "../../types/ceUnlock";

type RequirementItem = Pick<CeUnlockItem, "source" | "termo" | "procuracao" | "paid" | "delivered">;

/** Ícone de requisito para células de tabela: verde atendido, cinza pendente. */
export function CeUnlockRequirementIcon({ ok, label, subject }: { ok: boolean; label: string; subject?: string }) {
  const Icon = ok ? CheckCircle2 : Circle;
  return (
    <span
      role="img"
      className="inline-flex"
      aria-label={`${label}${subject ? ` ${subject}` : ""}: ${ok ? "atendido" : "pendente"}`}
      title={`${label}: ${ok ? "atendido" : "pendente"}`}
    >
      <Icon
        size={18}
        aria-hidden="true"
        className={ok ? "text-[var(--app-green)]" : "text-[var(--app-muted)] opacity-60"}
      />
    </span>
  );
}

/** Os quatro requisitos do desbloqueio, com o texto da situação de cada um. */
export function CeUnlockRequirements({ item }: { item: RequirementItem }) {
  const approved = item.source === "vip_annual" ? "Aprovado — anual VIP" : "Aprovado";
  const rows = [
    { label: "Termo de devolução", ok: item.termo, text: item.termo ? approved : "Pendente" },
    { label: "Procuração", ok: item.procuracao, text: item.procuracao ? approved : "Pendente" },
    { label: "Taxas locais", ok: item.paid, text: item.paid ? "Pagamento confirmado" : "Pagamento pendente" },
    { label: "BL original", ok: item.delivered, text: item.delivered ? "Entregue" : "Aguardando entrega" },
  ];
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-start gap-2">
          <CeUnlockRequirementIcon ok={r.ok} label={r.label} />
          <div>
            <dt className="text-xs font-semibold text-[var(--app-text-strong)]">{r.label}</dt>
            <dd className="text-xs text-[var(--app-muted)]">{r.text}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}
