import { CheckCircle2, Circle } from "lucide-react";

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
