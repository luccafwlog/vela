import { CheckCircle2, Circle } from "lucide-react";
import { StatusText } from "../ui/StatusText";
import { ceUnlockZptText, type CeUnlockZptItem } from "../../lib/ceUnlockLabels";

/**
 * Ícone de requisito para células de tabela: verde atendido, cinza pendente.
 * `dispensed`: requisito que o B/L não tem (veículo LCL isento, migration 575),
 * verde como atendido, com "dispensado" no texto.
 */
export function CeUnlockRequirementIcon({
  ok,
  label,
  subject,
  dispensed = false,
}: {
  ok: boolean;
  label: string;
  subject?: string;
  dispensed?: boolean;
}) {
  const met = ok || dispensed;
  const Icon = met ? CheckCircle2 : Circle;
  const state = dispensed ? "dispensado (veículo LCL isento)" : ok ? "atendido" : "pendente";
  return (
    <span
      role="img"
      className="inline-flex"
      aria-label={`${label}${subject ? ` ${subject}` : ""}: ${state}`}
      title={`${label}: ${state}`}
    >
      <Icon
        size={18}
        aria-hidden="true"
        className={met ? "text-[var(--app-green)]" : "text-[var(--app-muted)] opacity-60"}
      />
    </span>
  );
}

/**
 * Coluna "Na ZPT" (lote 3 da identidade): só o estado da ZPT ou o impedimento
 * que não é requisito, cada pendência uma vez. Divergente em vermelho com a
 * descrição da ZPT no title; impedimento em âmbar.
 */
export function CeUnlockZptState({ item }: { item: CeUnlockZptItem }) {
  const { text, tone, title } = ceUnlockZptText(item);
  if (tone === "strong") return <strong title={title}>{text}</strong>;
  return (
    <span title={title}>
      {tone === "default" ? text : <StatusText tone={tone}>{text}</StatusText>}
    </span>
  );
}
