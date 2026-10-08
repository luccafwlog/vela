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
    <Card className="app-bl-sheet">
      <section className="app-bl-sheet__section" aria-labelledby="bl-frete">
        <div className="app-bl-section-head">
          <h2 id="bl-frete" className="app-bl-section-title">Frete e despesas</h2>
          <span className="app-bl-facts__sub">Declarado pelo armador no B/L. Não é Taxa Local.</span>
        </div>
        {sorted.length === 0 ? (
          <p className="app-bl-facts__missing">Nenhuma linha de frete importada. Use &quot;Reimportar B/L&quot; para carregar o documento.</p>
        ) : (
          <div className="app-table-scroll">
            <table className="app-table app-table--compact app-bl-subtable min-w-[520px]">
              <thead>
                <tr>
                  <th scope="col" className="w-12">Nº</th>
                  <th scope="col">Descrição</th>
                  <th scope="col" className="text-right">Valor</th>
                  <th scope="col">Pagamento</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((line) => (
                  <tr key={line.seq}>
                    <td className="tabular-nums text-[var(--app-muted)]">{line.seq}</td>
                    <td>{line.description}</td>
                    <td className="text-right tabular-nums">{money(line.currency, line.amount)}</td>
                    <td>{line.payment ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Card>
  )
}
