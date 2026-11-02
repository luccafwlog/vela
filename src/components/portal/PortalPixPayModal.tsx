import type { ReactNode } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/Card'
import { LeadValue } from '../ui/Block'
import { PortalPixPaymentBlock } from './PortalPixPaymentBlock'

/**
 * "Pagar com Pix" da lista de Faturas do Portal (2026-11-01): o valor a pagar
 * e o mesmo Pix do detalhe, sem abrir a fatura inteira. "Ver detalhe da
 * fatura" leva ao detalhe completo.
 */
export function PortalPixPayModal({
  open,
  invoiceNumber,
  amount,
  amountDetail,
  pix,
  pixNote,
  loading = false,
  error = false,
  onOpenDetail,
  onClose,
}: {
  open: boolean
  invoiceNumber: string
  /** "R$ 1.150,00 a pagar"; `null` enquanto o detalhe carrega. */
  amount: ReactNode
  amountDetail?: ReactNode
  /** `null` = QR em preparação; `undefined` = a fatura já não pede pagamento. */
  pix: string | null | undefined
  pixNote?: ReactNode
  loading?: boolean
  error?: boolean
  onOpenDetail: () => void
  onClose: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title={`Pagar fatura ${invoiceNumber} com Pix`} size="sm">
      <div className="grid gap-4">
        {loading ? <p className="text-sm text-[var(--app-muted)]" role="status">Carregando o Pix…</p> : null}
        {error ? <InlineError message="Não foi possível carregar o Pix desta fatura. Tente de novo em instantes." /> : null}
        {!loading && !error ? (
          <>
            {/* Fatura paga ou cancelada enquanto a janela estava aberta: sem
                valor "a pagar", só o aviso e o caminho para o detalhe. */}
            {pix !== undefined
              ? (
                <>
                  <LeadValue tone="warning" detail={amountDetail}>{amount}</LeadValue>
                  <PortalPixPaymentBlock pixPayload={pix} note={pixNote} standalone />
                </>
              )
              : <p className="text-sm text-[var(--app-muted)]">Esta fatura não pede mais pagamento.</p>}
          </>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onOpenDetail}>Ver detalhe da fatura</Button>
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  )
}
