import { NoValue } from '../ui/NoValue'
import { shortTxid } from './pixReconciliationPresentation'

/** Identificador do Pix na tabela: encurtado em letra de código, inteiro no `title`. */
export function TxidCell({ txid, emptyLabel = 'Sem identificador do Pix' }: { txid: string | null | undefined; emptyLabel?: string }) {
  const value = (txid ?? '').trim()
  if (!value) return <NoValue label={emptyLabel} />
  return <span className="font-[var(--app-font-mono)]" title={value}>{shortTxid(value)}</span>
}
