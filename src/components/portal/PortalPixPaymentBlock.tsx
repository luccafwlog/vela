import { QRCodeSVG } from 'qrcode.react'
import { Card } from '../ui/Card'

// pixPayload null = cobrança Itaú ainda não confirmada pelo banco.
export function PortalPixPaymentBlock({ pixPayload }: { pixPayload: string | null }) {
  return (
    <Card className="p-4">
      <div className="mb-3 text-sm font-semibold">Pagamento via PIX</div>
      {pixPayload ? (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <QRCodeSVG value={pixPayload} size={120} level="M" />
          <div>
            <div className="mb-1 text-xs text-[var(--app-muted)]">Copia e cola</div>
            <div className="max-w-xs break-all rounded bg-[var(--app-surface-muted)] p-2 font-mono text-xs">
              {pixPayload}
            </div>
          </div>
        </div>
      ) : (
        <p role="status" className="text-sm text-[var(--app-muted)]">
          QR Code Pix em preparação. Ele aparece aqui em alguns minutos; atualize a página para conferir.
        </p>
      )}
    </Card>
  )
}
