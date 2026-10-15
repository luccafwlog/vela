import { Block } from '../ui/Block'
import { NoValue } from '../ui/NoValue'

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
    <Block title="Frete e despesas" flush aside="Declarado pelo armador no B/L. Não é Taxa Local.">
      {sorted.length === 0 ? (
        <p className="app-block__body app-facts__detail">Nenhuma linha de frete importada. Reimportar B/L, na faixa do alto, carrega o documento.</p>
      ) : (
        <div className="app-table-scroll">
          <table className="app-table app-table--compact">
            <caption className="sr-only">Frete e despesas</caption>
            <thead>
              <tr>
                <th scope="col">Nº</th>
                <th scope="col" className="app-table__text-head">Descrição</th>
                <th scope="col">Valor</th>
                <th scope="col">Pagamento</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((line) => (
                <tr key={line.seq}>
                  <td className="tabular-nums">{line.seq}</td>
                  <td className="app-table__text" title={line.description}>{line.description}</td>
                  <td className="whitespace-nowrap tabular-nums">{line.amount == null ? <NoValue label="Sem valor" /> : money(line.currency, line.amount)}</td>
                  <td>{line.payment ?? <NoValue label="Sem forma de pagamento" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Block>
  )
}
