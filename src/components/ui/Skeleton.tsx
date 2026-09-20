import { cn } from '../../lib/utils'

function SkeletonLine({ className }: { className?: string }) {
  return <div className={cn('app-skeleton app-skeleton-line', className)} />
}

export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  const widths = ['app-skeleton-line--full', 'app-skeleton-line--medium', 'app-skeleton-line--short']
  return (
    <div className={cn('app-skeleton-row', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} className={widths[i % widths.length]} />
      ))}
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 4, columnTemplate, label = 'Carregando tabela' }: { rows?: number; cols?: number; columnTemplate?: string; label?: string }) {
  return (
    <div style={{ padding: '0 4px' }} aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          style={{
            display: 'grid',
            gridTemplateColumns: columnTemplate ?? `repeat(${cols}, 1fr)`,
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid var(--app-border)',
          }}
        >
          {Array.from({ length: cols }, (_, c) => (
            <SkeletonLine
              key={c}
              className={c === 0 ? 'app-skeleton-line--medium' : c === cols - 1 ? 'app-skeleton-line--short' : 'app-skeleton-line--full'}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
