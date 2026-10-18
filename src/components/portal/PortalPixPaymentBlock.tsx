import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { Button } from '../ui/Button'

/**
 * Bloco Pagamento do detalhe da fatura no Portal (lote 1 da identidade,
 * 2026-10-14; Pix em faixa baixa no lote 4, 2026-10-18): o que pagar vem
 * primeiro, com os dados de apoio embaixo e o Pix ao lado, da mesma altura.
 * Sem Pix (fatura paga ou cancelada), o bloco mostra só os valores.
 */
export function PortalPaymentBlock({
  situation,
  amountLabel,
  amount,
  amountTone = 'default',
  facts,
  factColumns = 3,
  pix,
  pixNote,
  leadAction,
  children,
}: {
  /** Faixa do bloco: tipo, emissão e situação. */
  situation: ReactNode
  /** Linha de apoio sob o valor; opcional quando o próprio valor já diz tudo. */
  amountLabel?: ReactNode
  amount: ReactNode
  amountTone?: 'default' | 'warning' | 'muted'
  /** `wide` ocupa duas colunas (descrição da avulsa); `className` ajusta um fato só. */
  facts: Array<{ label: string; value: ReactNode; wide?: boolean; className?: string }>
  factColumns?: 2 | 3 | 4
  /** `undefined` esconde o Pix; `null` mostra o Pix em preparação. */
  pix?: string | null
  /** Aviso curto sob "Pague com Pix" ("o QR cobra o saldo, R$ …"). */
  pixNote?: ReactNode
  /** Ação logo abaixo do valor (Abrir a consolidada que cobriu a fatura). */
  leadAction?: ReactNode
  /** Conteúdo extra sob os dados (aviso do câmbio). */
  children?: ReactNode
}) {
  return (
    <Block title="Pagamento" aside={situation} headingLevel={3}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="grid min-w-0 content-start gap-3">
          <LeadValue tone={amountTone} detail={amountLabel}>{amount}</LeadValue>
          {leadAction}
          {facts.length > 0 ? (
            <FactList columns={factColumns}>
              {facts.map((fact) => <Fact key={fact.label} label={fact.label} className={fact.wide ? 'col-span-2' : fact.className}>{fact.value}</Fact>)}
            </FactList>
          ) : null}
          {children}
        </div>
        {pix !== undefined ? <PortalPixPaymentBlock pixPayload={pix} note={pixNote} /> : null}
      </div>
    </Block>
  )
}

/**
 * Pix em faixa baixa: QR pequeno, o código numa linha só (o valor inteiro
 * continua selecionável e no `title`) e o botão de copiar.
 * pixPayload null = cobrança Itaú ainda não confirmada pelo banco.
 */
export function PortalPixPaymentBlock({ pixPayload, note }: { pixPayload: string | null; note?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-t border-[var(--app-border-soft)] pt-3 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
      {pixPayload ? <QRCodeSVG value={pixPayload} size={88} level="M" className="shrink-0" title="QR Code Pix" /> : null}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] justify-items-start gap-1.5">
        <p className="text-sm font-semibold">Pague com Pix</p>
        {pixPayload ? (
          <>
            {note ? <p className="text-xs text-[var(--app-muted)]">{note}</p> : null}
            <code
              className="block w-full max-w-[200px] truncate rounded bg-[var(--app-surface-muted)] px-1.5 py-0.5 font-[family-name:var(--app-font-mono)] text-xs text-[var(--app-muted)]"
              title={pixPayload}
            >
              {pixPayload}
            </code>
            <CopyPixButton payload={pixPayload} />
          </>
        ) : (
          <p role="status" className="max-w-[18rem] text-sm text-[var(--app-muted)]">
            QR Code Pix em preparação. Ele aparece aqui em alguns minutos; atualize a página para conferir.
          </p>
        )}
      </div>
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
      <Button variant="secondary" className="app-btn--sm" onClick={() => void copy()}>
        {state === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        {state === 'copied' ? 'Código copiado' : 'Copiar código Pix'}
      </Button>
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Código Pix copiado' : state === 'failed' ? 'Não foi possível copiar o código Pix; selecione o texto e copie.' : ''}
      </span>
    </>
  )
}
