import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'

export function DemurrageCell({ container }: { container: { ownership?: string | null; discharge_date?: string | null; demurrage_status?: string | null } }) {
  if (container.ownership === 'SOC') return <StatusText tone="muted">Não se aplica (SOC)</StatusText>
  // Sem descarga o banco grava "no free time" por padrão (migration 197).
  if (!container.discharge_date) return <NoValue label="Sem descarga" />
  if (container.demurrage_status === 'returned') return <StatusText tone="muted">Devolvido</StatusText>
  if (container.demurrage_status === 'overdue') return <StatusText tone="warning">Em atraso</StatusText>
  return <StatusText>No free time</StatusText>
}

export function ProfileCell({ isImo, isOog, imoClass, unNumber }: { isImo: boolean; isOog: boolean; imoClass?: string | null; unNumber?: string | null }) {
  if (!isImo && !isOog) return <span className="text-[var(--app-muted)]">Padrão</span>
  const imo = isImo ? [`IMO${imoClass ? ` ${imoClass}` : ''}`, unNumber ? `ONU ${unNumber}` : ''].filter(Boolean).join(' · ') : ''
  return <span className="whitespace-nowrap">{[imo, isOog ? 'OOG' : ''].filter(Boolean).join(' · ')}</span>
}
