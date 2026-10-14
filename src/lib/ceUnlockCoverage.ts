import type { CeUnlockDocument } from "../types/ceUnlock";

/**
 * Data até a qual um documento anual VIP cobre os pedidos: o aprovado e
 * vigente hoje mais recente daquele tipo. O banco decide se há cobertura
 * (`ce_unlock_private.annual`); isto só lê a data para mostrar.
 */
export function coveredUntil(documents: CeUnlockDocument[], type: CeUnlockDocument["type"], today = new Date().toLocaleDateString("en-CA")): string | null {
  const current = documents
    .filter((d) => d.type === type && d.status === "approved" && d.valid_until && d.valid_until.slice(0, 10) >= today && (!d.valid_from || d.valid_from.slice(0, 10) <= today))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return current[0]?.valid_until ?? null;
}
