import { NoValue } from '../ui/NoValue'
import { shortTxid } from './pixReconciliationPresentation'

/** Identificador do Pix na tabela: encurtado em letra de código, inteiro no `title`. */
export function TxidCell({ txid }: { txid: string | null | undefined }) {
  const value = (txid ?? '').trim()
  if (!value) return <NoValue label="Sem identificador do Pix" />
  return <span className="font-[var(--app-font-mono)]" title={value}>{shortTxid(value)}</span>
}
