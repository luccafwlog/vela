import { ceActionLabel, ceDateTime } from "../../lib/ceUnlockLabels";
import type { CeUnlockRequest } from "../../types/ceUnlock";

/** Histórico do pedido, recolhido por padrão: é consulta, não ação. */
export function CeUnlockHistory({ events }: { events: CeUnlockRequest["events"] }) {
  if (!events.length) return null;
  return (
    <details className="group">
      <summary className="app-panel__title cursor-pointer select-none">Histórico ({events.length})</summary>
      <ol className="mt-3 space-y-2 border-l border-[var(--app-border)] pl-4">
        {events.map((e) => (
          <li key={e.id} className="text-sm">
            <span className="block text-xs text-[var(--app-muted)]">{ceDateTime(e.created_at)}</span>
            <span className="text-[var(--app-text-strong)]">{ceActionLabel(e.action)}</span>
            {e.reason ? <span className="text-[var(--app-muted)]"> · {e.reason}</span> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
