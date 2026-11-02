import { RefreshCw } from 'lucide-react'
import { useRoeHeaderRate } from '../../hooks/useRoeHeaderRate'
import { formatDate } from '../../lib/utils'
import { RowActionButton } from '../ui/RowActionButton'
import { StatusText } from '../ui/StatusText'

function formatRate(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

/**
 * Câmbio de referência da Demurrage, logo abaixo do título da tela: PTAX venda,
 * ROE (PTAX × 1,065), a data da cotação e o botão de atualizar. Até
 * 2026-11-01 ficava na faixa do alto de todas as telas do Vela, junto com
 * "N containers em atraso"; o dono decidiu que é assunto só da Demurrage, e a
 * contagem já é o cartão Correndo desta tela. Só lê: quem grava a PTAX é a
 * rotina do BCB ou o Informar PTAX, no servidor.
 */
export function DemurrageExchangeRate() {
  const rates = useRoeHeaderRate()

  const hint = rates.unavailable
    ? 'Cotação PTAX indisponível no momento — tente atualizar mais tarde.'
    : rates.offline && rates.cachedAt
      ? `Cotação em cache de ${new Intl.DateTimeFormat('pt-BR').format(new Date(rates.cachedAt))}.`
      : 'Cotação PTAX Venda mais recente do Banco Central e ROE com spread fixo de 1,065.'
  const value = 'font-semibold tabular-nums text-[var(--app-text)]'

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" title={hint}>
      {rates.loading ? (
        <span>Carregando câmbio…</span>
      ) : rates.unavailable ? (
        <StatusText tone="warning">Câmbio indisponível</StatusText>
      ) : (
        <>
          <span>PTAX venda <span className={value}>R$ {formatRate(rates.ptax)}</span></span>
          <span aria-hidden="true">·</span>
          <span>ROE (PTAX × 1,065) <span className={value}>R$ {formatRate(rates.roe)}</span></span>
          <span aria-hidden="true">·</span>
          <span>cotação de {rates.effectiveDate ? formatDate(rates.effectiveDate) : '—'}</span>
          {rates.offline ? <StatusText tone="warning">em cache</StatusText> : null}
        </>
      )}
      <RowActionButton label="Atualizar cotação PTAX" icon={RefreshCw} variant="ghost" onClick={() => void rates.refresh()} />
    </span>
  )
}
