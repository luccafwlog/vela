import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useImportEffects } from '../../hooks/useImportEffects'
import { sanitizeIssueMessage } from '../../services/importValidation'
import type { ImportEffect, ImportEffectKind, ImportEffectState } from '../../services/importEffects'
import { Badge, type SemanticBadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'
import { useConfirm } from '../ui/ConfirmDialog'

const KIND_LABELS: Record<ImportEffectKind, string> = {
  physical_flags: 'Flags físicas do Baplie',
  provisional_charges: 'Cálculo provisório de taxas locais',
  local_billing: 'Cálculo de taxas locais',
  granite_billing: 'Cálculo de taxas de Granito',
  demurrage_billing: 'Emissão de Demurrage',
  vehicle_followup: 'Isenção após importação de veículos',
}

const STATUS_LABELS: Record<ImportEffectState, string> = {
  pending: 'Pendente',
  running: 'Em processamento',
  retry_wait: 'Aguardando nova tentativa',
  blocked: 'Bloqueado',
  succeeded: 'Concluído',
  superseded: 'Substituído por uma versão mais nova',
}

function importEffectKindLabel(kind: ImportEffectKind): string {
  return KIND_LABELS[kind] ?? kind
}

function importEffectStatusLabel(status: ImportEffectState): string {
  return STATUS_LABELS[status] ?? status
}

function statusTone(status: ImportEffectState): SemanticBadgeTone {
  if (status === 'succeeded') return 'success'
  if (status === 'blocked') return 'danger'
  if (status === 'superseded') return 'neutral'
  return 'warning'
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function effectError(effect: ImportEffect) {
  const message = effect.last_error_message?.trim()
  return message ? sanitizeIssueMessage(message) : null
}

export function ImportResultPanel({
  entityId,
  title = 'Processamento pós-importação',
  alwaysVisible = false,
}: {
  entityId?: string | null
  title?: string
  alwaysVisible?: boolean
}) {
  const normalizedEntityId = entityId?.trim() ?? ''
  const { data: effects, isPending, error, refetch, retryMutation } = useImportEffects(normalizedEntityId)
  const confirm = useConfirm()
  const [retryError, setRetryError] = useState<string | null>(null)

  if (!normalizedEntityId) return null

  if (isPending) {
    return (
      <section className="app-import-effects" aria-label={title} aria-busy="true" data-testid="import-result-panel-loading">
        <h2 className="app-import-effects__title">{title}</h2>
        <p className="app-import-effects__meta">Consultando o resultado gravado…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="app-import-effects" role="alert" aria-label={title}>
        <h2 className="app-import-effects__title">{title}</h2>
        <p className="app-import-effects__error">
          Não foi possível consultar o resultado gravado. A importação não é desfeita.
        </p>
        <Button variant="secondary" className="app-btn--sm" onClick={() => void refetch()}>Tentar novamente</Button>
      </section>
    )
  }

  if (!effects?.length) {
    return alwaysVisible ? (
      <section className="app-import-effects" aria-label={title} data-testid="import-result-panel-empty">
        <h2 className="app-import-effects__title">{title}</h2>
        <p className="app-import-effects__meta">Nenhum processamento pendente ou registrado para este item.</p>
      </section>
    ) : null
  }

  const activeCount = effects.filter((effect) => effect.status === 'pending' || effect.status === 'running' || effect.status === 'retry_wait').length
  const blockedCount = effects.filter((effect) => effect.status === 'blocked').length

  const requestRetry = (effect: ImportEffect) => {
    void (async () => {
      const confirmed = await confirm({
        title: 'Reprocessar efeito bloqueado',
        message: `Confirma o reprocessamento de “${importEffectKindLabel(effect.effect_kind)}”? A tentativa será registrada na auditoria.`,
        confirmLabel: 'Reprocessar',
      })
      if (!confirmed) return

      setRetryError(null)
      try {
        await retryMutation.mutateAsync({
          effectId: effect.id,
          justification: 'Reprocessamento solicitado pelo painel de resultado da importação.',
        })
      } catch (retryFailure) {
        setRetryError(retryFailure instanceof Error ? retryFailure.message : 'Falha ao reabrir o efeito.')
      }
    })()
  }

  const summary = [
    activeCount ? `${activeCount} em andamento` : null,
    blockedCount ? `${blockedCount} ${blockedCount === 1 ? 'bloqueado exige' : 'bloqueados exigem'} ação` : null,
  ].filter(Boolean).join(' · ')

  return (
    <section className="app-import-effects" aria-label={title} data-testid="import-result-panel">
      <div className="app-import-effects__head">
        <h2 className="app-import-effects__title">{title}</h2>
        <span className="app-import-effects__meta">Atualizado em {formatDate(effects[0]?.updated_at)}</span>
      </div>
      <p className="app-import-effects__meta">
        O que o servidor fez depois da importação.{summary ? ` ${summary}.` : ' Nada pendente.'}
      </p>

      <ul className="app-import-effects__list" aria-label="Efeitos da importação">
        {effects.map((effect) => {
          const errorMessage = effectError(effect)
          return (
            <li key={effect.id} className="app-import-effects__item">
              <div className="app-import-effects__row">
                <span className="app-import-effects__name">{importEffectKindLabel(effect.effect_kind)}</span>
                <Badge tone={statusTone(effect.status)}>{importEffectStatusLabel(effect.status)}</Badge>
              </div>
              <div className="app-import-effects__meta">
                {effect.attempts} {effect.attempts === 1 ? 'tentativa' : 'tentativas'} · atualizado em {formatDate(effect.updated_at)}
              </div>
              {errorMessage ? <p className="app-import-effects__error">{errorMessage}</p> : null}
              {effect.status === 'blocked' ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="app-import-effects__retry"
                  loading={retryMutation.isPending && retryMutation.variables?.effectId === effect.id}
                  loadingLabel="Reprocessando…"
                  disabled={retryMutation.isPending}
                  onClick={() => requestRetry(effect)}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  Reprocessar efeito
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
      {retryError ? <p className="app-import-effects__error" role="alert">{sanitizeIssueMessage(retryError)}</p> : null}
    </section>
  )
}
