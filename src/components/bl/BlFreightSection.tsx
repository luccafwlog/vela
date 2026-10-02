import { Card } from '../ui/Card'

export type BlFreightLine = {
  bl_id: string
  seq: number
  description: string
  category: string | null
  mercante_code: string | null
  currency: string | null
  amount: number | null
  payment: 'PREPAID' | 'COLLECT' | null
}

const money = (currency: string | null, amount: number | null) =>
  amount == null ? '—' : `${currency ?? ''} ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(amount)}`.trim()

// Frete & Despesas do BL: dado declarado pelo armador (fonte do C5 do EDI).
// Distinto de Taxas Locais — somente leitura aqui (CONTEXT.md).
export function BlFreightSection({ freightLines }: { freightLines: BlFreightLine[] }) {
  const sorted = [...freightLines].sort((a, b) => a.seq - b.seq)
  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold text-[var(--app-text-strong)]">Frete e despesas</h2>
      <p className="mb-4 text-sm text-[var(--app-muted)]">Declarado pelo armador no B/L. Não é Taxa Local.</p>
      {sorted.length === 0 ? (
        <p className="text-sm text-[var(--app-muted)]">Nenhuma linha de frete importada. Use &quot;Importar B/L&quot; para carregar o documento.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-[var(--app-muted)]">
                <th className="py-1 pr-3">#</th>
                <th className="py-1 pr-3">Descrição</th>
                <th className="py-1 pr-3 text-right">Valor</th>
                <th className="py-1 pr-3">Pagamento</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((line) => (
                <tr key={line.seq} className="border-t border-[var(--app-border)]">
                  <td className="py-1 pr-3 text-[var(--app-muted)]">{line.seq}</td>
                  <td className="py-1 pr-3">{line.description}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{money(line.currency, line.amount)}</td>
                  <td className="py-1 pr-3">{line.payment ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
