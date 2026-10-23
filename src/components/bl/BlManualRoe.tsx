import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Fact, FactList } from '../ui/Block'
import { Field, Input, Textarea } from '../ui/Input'
import { NoValue } from '../ui/NoValue'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { setBlManualRoe } from '../../services/blDemurrageConfig'
import { queryKeys } from '../../services/queryKeys'
import { userFacingErrorMessage } from '../../lib/errors'
import { canManageManualRoe, parsePtaxInput } from '../demurrage/demurrageFormRules'

function formatRoe(roe: number) {
  return roe.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

// ROE manual do B/L (ADR 0094, B10; migration 435): a próxima Invoice de
// Demurrage sai com ele, fora do recálculo pela PTAX. Financeiro,
// Administrativo e Equipamentos põem e tiram, sempre com motivo; o banco
// recusa os demais setores.
export function BlManualRoe({ blId, roe, manual }: { blId: string; roe: number | null; manual: boolean }) {
  const queryClient = useQueryClient()
  const { effectiveRole } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [mode, setMode] = useState<'view' | 'set' | 'remove'>('view')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const active = manual && roe != null
  const parsed = parsePtaxInput(value)
  const mutation = useMutation({
    mutationFn: (next: number | null) => setBlManualRoe({ blId, roe: next, reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail(blId) }),
  })

  function close() {
    setMode('view')
    setValue('')
    setReason('')
    setError('')
  }

  async function submit() {
    setError('')
    const next = mode === 'set' ? parsed : null
    if (mode === 'set' && next == null) {
      setError('Informe o ROE com vírgula ou ponto decimal, por exemplo 5,8123.')
      return
    }
    if (!await confirm(mode === 'set' ? {
      title: 'Definir ROE manual do B/L?',
      message: `O B/L ${blId} passa a usar o ROE ${formatRoe(next as number)} na próxima Invoice de Demurrage.`,
      consequence: 'A Invoice emitida a partir de agora fica fora do recálculo diário pela PTAX. Invoice já emitida segue o câmbio dela.',
      reversibility: 'Tire o ROE manual por esta mesma ação; o motivo fica no histórico do B/L.',
      confirmLabel: 'Definir ROE manual',
    } : {
      title: 'Tirar o ROE manual do B/L?',
      message: `A próxima Invoice de Demurrage do B/L ${blId} usa o câmbio de referência do dia.`,
      consequence: 'Invoice já emitida com ROE manual segue com ele até alguém usar "Tirar ROE manual" no detalhe dela.',
      reversibility: 'Defina o ROE manual de novo quando precisar; o motivo fica no histórico do B/L.',
      confirmLabel: 'Tirar ROE manual',
    })) return
    try {
      await mutation.mutateAsync(next)
      showToast(mode === 'set' ? 'ROE manual do B/L definido.' : 'ROE manual do B/L retirado.', 'success')
      close()
    } catch (caught) {
      const message = userFacingErrorMessage(caught, 'Falha ao gravar o ROE manual do B/L.')
      setError(message)
      showToast(message, 'error')
    }
  }

  const canManage = canManageManualRoe(effectiveRole)
  return (
    <>
      <FactList columns={3}>
        <Fact label="ROE manual" detail={active ? 'a próxima Invoice sai com ele, fora da PTAX' : undefined}>
          {active ? <span className="tabular-nums">{formatRoe(roe)}</span> : <NoValue label="Sem ROE manual: a Invoice segue a PTAX do dia" />}
        </Fact>
      </FactList>
      {canManage && mode === 'view' ? (
        <div className="flex gap-2">
          <Button variant="secondary" className="app-btn--sm" onClick={() => setMode('set')}>{active ? 'Trocar ROE manual…' : 'Definir ROE manual…'}</Button>
          {active ? <Button variant="ghost" className="app-btn--sm" onClick={() => setMode('remove')}>Tirar ROE manual…</Button> : null}
        </div>
      ) : null}
      {canManage && mode !== 'view' ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] md:items-start">
          {mode === 'set' ? (
            <Field label="ROE manual (R$ por US$)" required>
              <Input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="5,8123" />
            </Field>
          ) : null}
          <Field label={mode === 'set' ? 'Motivo do ROE manual' : 'Motivo para tirar o ROE manual'} required hint="Mínimo de 10 caracteres; fica no histórico do B/L.">
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          {error ? <p role="alert" className="text-[var(--app-danger-fg)] md:col-span-2">{error}</p> : null}
          <div className="flex gap-2 md:col-span-2">
            <Button type="button" variant="ghost" onClick={close}>Voltar</Button>
            <Button
              type="button"
              variant="secondary"
              disabled={reason.trim().length < 10 || (mode === 'set' && !value.trim())}
              loading={mutation.isPending}
              onClick={() => void submit()}
            >
              {mode === 'set' ? 'Definir ROE manual' : 'Tirar ROE manual'}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}
