import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { Button } from '../ui/Button'

/**
 * Bloco Pagamento do detalhe da fatura no Portal (lote 1 da identidade,
 * 2026-10-14): o que pagar vem primeiro, com o valor em destaque e o Pix ao
 * lado. Sem Pix (fatura paga ou cancelada), o bloco mostra só os valores.
 */
export function PortalPaymentBlock({
  situation,
  amountLabel,
  amount,
  amountTone = 'default',
  facts,
  pix,
}: {
  situation: ReactNode
  amountLabel: string
  amount: ReactNode
  amountTone?: 'default' | 'warning'
  facts: Array<{ label: string; value: ReactNode }>
  /** `undefined` esconde o Pix; `null` mostra o Pix em preparação. */
  pix?: string | null
}) {
  return (
    <Block title="Pagamento" aside={situation} headingLevel={3}>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid content-start gap-3">
          <LeadValue tone={amountTone} detail={amountLabel}>{amount}</LeadValue>
          <FactList columns={3}>
            {facts.map((fact) => <Fact key={fact.label} label={fact.label}>{fact.value}</Fact>)}
          </FactList>
        </div>
        {pix !== undefined ? <PortalPixPaymentBlock pixPayload={pix} /> : null}
      </div>
    </Block>
  )
}

// pixPayload null = cobrança Itaú ainda não confirmada pelo banco.
export function PortalPixPaymentBlock({ pixPayload }: { pixPayload: string | null }) {
  return (
    <div className="grid content-start gap-2 sm:max-w-[18rem]">
      <div className="text-sm font-semibold">Pagamento via PIX</div>
      {pixPayload ? (
        <>
          <QRCodeSVG value={pixPayload} size={120} level="M" />
          <div className="text-xs text-[var(--app-muted)]">Copia e cola</div>
          <div className="break-all rounded bg-[var(--app-surface-muted)] p-2 font-mono text-xs">{pixPayload}</div>
          <CopyPixButton payload={pixPayload} />
        </>
      ) : (
        <p role="status" className="text-sm text-[var(--app-muted)]">
          QR Code Pix em preparação. Ele aparece aqui em alguns minutos; atualize a página para conferir.
        </p>
      )}
    </div>
  )
}

function CopyPixButton({ payload }: { payload: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard indisponível')
      await navigator.clipboard.writeText(payload)
      setState('copied')
    } catch {
      setState('failed')
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }

  return (
    <>
      <Button variant="secondary" className="app-btn--sm justify-self-start" onClick={() => void copy()}>
        {state === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        {state === 'copied' ? 'Código copiado' : 'Copiar código Pix'}
      </Button>
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Código Pix copiado' : state === 'failed' ? 'Não foi possível copiar o código Pix; selecione o texto e copie.' : ''}
      </span>
    </>
  )
}
