import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { NoValue } from '../ui/NoValue'
import { SummaryStrip } from '../ui/SummaryStrip'
import { ImportFootnote, ImportNotice, ImportSection } from '../shared/ImportParts'
import { plural } from '../shared/importPresentation'
import { formatCnpjCpf } from '../../lib/utils'
import { userFacingErrorMessage } from '../../lib/errors'
import { lookupCnpj } from '../../services/cnpjLookup'
import {
  RECEITA_FILL_FIELDS,
  RECEITA_FILL_LABELS,
  applyReceitaFill,
  listCustomersMissingReceitaData,
  planReceitaFill,
  type ReceitaFill,
  type ReceitaFillCustomer,
} from '../../services/customerReceitaFill'

type LookupOutcome =
  | { kind: 'completa'; fill: ReceitaFill; situacao: string }
  | { kind: 'nada'; situacao: string }
  | { kind: 'nao_encontrado' }
  | { kind: 'indisponivel' }

type SaveOutcome = { kind: 'gravado' } | { kind: 'sem_mudanca' } | { kind: 'falhou'; message: string }

type Row = { customer: ReceitaFillCustomer; lookup?: LookupOutcome; save?: SaveOutcome }

type Phase = 'lista' | 'consultando' | 'conferencia' | 'gravando' | 'resultado'

const LIST_KEY = ['customers', 'receita-fill'] as const

function describeFill(fill: ReceitaFill) {
  return RECEITA_FILL_FIELDS.filter((field) => fill[field])
    .map((field) => `${RECEITA_FILL_LABELS[field]}: ${field === 'zip' ? `${fill.zip!.slice(0, 5)}-${fill.zip!.slice(5)}` : fill[field]}`)
    .join(' · ')
}

function describeLookup(outcome: LookupOutcome | undefined) {
  if (!outcome) return <NoValue label="Ainda não consultado" />
  if (outcome.kind === 'completa') return describeFill(outcome.fill)
  if (outcome.kind === 'nada') return 'A Receita não tem o que falta.'
  if (outcome.kind === 'nao_encontrado') return 'CNPJ não encontrado na Receita.'
  return 'Consulta indisponível agora; tente de novo depois.'
}

function describeSave(outcome: SaveOutcome | undefined) {
  if (!outcome) return null
  if (outcome.kind === 'gravado') return 'Gravado.'
  if (outcome.kind === 'sem_mudanca') return 'Já preenchido por alguém; nada mudou.'
  return `Não gravado: ${outcome.message}`
}

/**
 * Completar pela Receita (pedido do dono de 2026-11-06): Clientes ativos a que
 * falta nome fantasia ou endereço → consulta a Receita um a um → prévia do que
 * entra → grava só os campos vazios, com Histórico. Razão social e CNPJ não
 * mudam. Fechar a janela interrompe a consulta; nada é gravado antes de
 * "Gravar".
 *
 * ponytail: consulta em série, um CNPJ por vez, no navegador. A BrasilAPI não
 * publica limite de uso; com milhares de Clientes, levar a rodada para uma
 * Edge Function com fila e pausa entre consultas.
 */
export function ReceitaFillModal({ open, onClose, changedBy }: { open: boolean; onClose: () => void; changedBy: string | null }) {
  const queryClient = useQueryClient()
  const list = useQuery({ queryKey: LIST_KEY, queryFn: listCustomersMissingReceitaData, enabled: open, staleTime: 0 })
  const [rows, setRows] = useState<Row[] | null>(null)
  const [phase, setPhase] = useState<Phase>('lista')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)

  useEffect(() => {
    if (!open) return
    cancelled.current = false
    return () => {
      cancelled.current = true
    }
  }, [open])

  const customers = list.data ?? []
  const shownRows: Row[] = rows ?? customers.map((customer) => ({ customer }))
  const toFill = shownRows.filter((row) => row.lookup?.kind === 'completa')
  const counts = {
    completa: toFill.length,
    nada: shownRows.filter((row) => row.lookup?.kind === 'nada').length,
    naoEncontrado: shownRows.filter((row) => row.lookup?.kind === 'nao_encontrado').length,
    indisponivel: shownRows.filter((row) => row.lookup?.kind === 'indisponivel').length,
    gravado: shownRows.filter((row) => row.save?.kind === 'gravado').length,
    falhou: shownRows.filter((row) => row.save?.kind === 'falhou').length,
  }

  function close() {
    cancelled.current = true
    setRows(null)
    setPhase('lista')
    setProgress(0)
    setError(null)
    onClose()
  }

  async function consult() {
    const next: Row[] = customers.map((customer) => ({ customer }))
    setRows(next)
    setPhase('consultando')
    setProgress(0)
    setError(null)
    for (let index = 0; index < next.length; index++) {
      if (cancelled.current) return
      const { customer } = next[index]
      const result = await lookupCnpj(customer.cnpj_cpf)
      let lookup: LookupOutcome
      if (result.status === 'encontrado') {
        const fill = planReceitaFill(customer, result.data)
        lookup = Object.keys(fill).length ? { kind: 'completa', fill, situacao: result.data.situacao } : { kind: 'nada', situacao: result.data.situacao }
      } else {
        lookup = { kind: result.status }
      }
      next[index] = { ...next[index], lookup }
      if (cancelled.current) return
      setRows([...next])
      setProgress(index + 1)
    }
    setPhase('conferencia')
  }

  async function save() {
    if (!changedBy || !rows) return
    const next = [...rows]
    setPhase('gravando')
    setProgress(0)
    let done = 0
    for (let index = 0; index < next.length; index++) {
      const lookup = next[index].lookup
      if (lookup?.kind !== 'completa') continue
      try {
        const fields = await applyReceitaFill(next[index].customer.id, lookup.fill, changedBy)
        next[index] = { ...next[index], save: fields.length ? { kind: 'gravado' } : { kind: 'sem_mudanca' } }
      } catch (cause) {
        next[index] = { ...next[index], save: { kind: 'falhou', message: userFacingErrorMessage(cause, 'falha ao gravar') } }
      }
      done++
      setRows([...next])
      setProgress(done)
    }
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-ficha'] }),
      ])
    } catch (cause) {
      setError(userFacingErrorMessage(cause, 'Gravado, mas a lista não recarregou. Atualize a página.'))
    }
    setPhase('resultado')
  }

  const busy = phase === 'consultando' || phase === 'gravando'
  let footnote = 'Nada é gravado antes de você conferir a prévia e gravar.'
  let tone: 'default' | 'warning' | 'success' = 'default'
  if (phase === 'consultando') footnote = `Consultando a Receita: ${progress} de ${shownRows.length}. Fechar a janela interrompe a consulta; nada foi gravado.`
  else if (phase === 'conferencia') footnote = counts.completa ? `Prévia pronta: ${plural(counts.completa, 'Cliente a completar', 'Clientes a completar')}. Nada foi gravado ainda.` : 'A Receita não tem o que completar nesses Clientes. Nada foi gravado.'
  else if (phase === 'gravando') footnote = `Gravando: ${progress} de ${counts.completa}.`
  else if (phase === 'resultado') {
    footnote = counts.falhou ? `${plural(counts.gravado, 'Cliente completado', 'Clientes completados')}; ${plural(counts.falhou, 'falhou', 'falharam')}. Os demais já estão gravados.` : `${plural(counts.gravado, 'Cliente completado', 'Clientes completados')}. Cada campo está no Histórico do Cliente.`
    tone = counts.falhou ? 'warning' : 'success'
  }

  return (
    <Modal open={open} onClose={busy ? () => undefined : close} title="Completar pela Receita">
      <div className="app-import">
        <ImportNotice tone="info" title="Só os campos vazios">
          <p>Para cada Cliente ativo sem nome fantasia, endereço, cidade, UF ou CEP, o Vela consulta o CNPJ na Receita Federal e preenche o que está vazio. O que já está preenchido, a razão social e o CNPJ não mudam.</p>
          <p>Cada campo gravado entra no Histórico do Cliente, com quem gravou e o motivo.</p>
        </ImportNotice>

        {list.isError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível listar os Clientes">
            <p>{userFacingErrorMessage(list.error, 'Tente de novo em instantes.')}</p>
          </ImportNotice>
        ) : null}

        {error ? (
          <ImportNotice tone="warning" role="status">
            <p>{error}</p>
          </ImportNotice>
        ) : null}

        <ImportSection
          title={phase === 'lista' ? 'Clientes com dados faltando' : phase === 'resultado' ? 'Resultado' : 'Prévia'}
          aside={
            <SummaryStrip
              items={[
                { label: 'Clientes', value: shownRows.length },
                ...(phase === 'lista' ? [] : [
                  { label: 'a completar', value: counts.completa },
                  { label: 'sem o que completar', value: counts.nada },
                  { label: 'não encontrados', value: counts.naoEncontrado, tone: counts.naoEncontrado ? 'warning' as const : 'default' as const },
                  { label: 'indisponíveis', value: counts.indisponivel, tone: counts.indisponivel ? 'warning' as const : 'default' as const },
                ]),
                ...(phase === 'resultado' ? [
                  { label: 'gravados', value: counts.gravado },
                  { label: 'falharam', value: counts.falhou, tone: counts.falhou ? 'danger' as const : 'default' as const },
                ] : []),
              ]}
            />
          }
        >
          {list.isPending ? (
            <p className="text-[var(--app-muted)]" role="status">Listando os Clientes…</p>
          ) : shownRows.length === 0 ? (
            <p className="text-[var(--app-muted)]" role="status">Todos os Clientes ativos com CNPJ já têm nome fantasia e endereço completos.</p>
          ) : (
            <div className="app-table-scroll app-import-table">
              <table className="app-table app-table--compact min-w-[760px]">
                <caption className="sr-only">Clientes e o que a Receita completa</caption>
                <thead>
                  <tr>
                    <th scope="col">CNPJ</th>
                    <th scope="col" className="app-table__text-head">Razão social</th>
                    <th scope="col" className="app-table__text-head">Falta</th>
                    <th scope="col" className="app-table__text-head">O que entra</th>
                    {phase === 'resultado' || phase === 'gravando' ? <th scope="col" className="app-table__text-head">Gravação</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {shownRows.map((row) => (
                    <tr key={row.customer.id}>
                      <td className="tabular-nums whitespace-nowrap">{formatCnpjCpf(row.customer.cnpj_cpf)}</td>
                      <td className="app-table__text" title={row.customer.name}>{row.customer.name}</td>
                      <td className="app-table__text">
                        {RECEITA_FILL_FIELDS.filter((field) => !(row.customer[field] ?? '').trim()).map((field) => RECEITA_FILL_LABELS[field]).join(', ')}
                      </td>
                      <td className="app-table__text">
                        {describeLookup(row.lookup)}
                        {row.lookup && 'situacao' in row.lookup && row.lookup.situacao && row.lookup.situacao !== 'ATIVA'
                          ? <span className="app-import-tone--warning"> Situação na Receita: {row.lookup.situacao}.</span>
                          : null}
                      </td>
                      {phase === 'resultado' || phase === 'gravando' ? (
                        <td className={row.save?.kind === 'falhou' ? 'app-table__text app-import-tone--danger' : 'app-table__text'}>{describeSave(row.save)}</td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ImportSection>

        <div className="app-modal__actions">
          <ImportFootnote tone={tone}>{footnote}</ImportFootnote>
          {phase === 'resultado' ? (
            <Button onClick={close}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={phase === 'gravando'} onClick={close}>
                {phase === 'consultando' ? 'Interromper' : 'Voltar'}
              </Button>
              {phase === 'conferencia' ? (
                <Button disabled={!counts.completa || !changedBy} onClick={() => void save()}>
                  {counts.completa ? `Gravar em ${plural(counts.completa, 'Cliente', 'Clientes')}` : 'Nada a gravar'}
                </Button>
              ) : (
                <Button
                  disabled={!shownRows.length || list.isPending}
                  loading={busy}
                  loadingLabel={phase === 'gravando' ? 'Gravando…' : 'Consultando…'}
                  onClick={() => void consult()}
                >
                  {shownRows.length ? `Consultar a Receita (${plural(shownRows.length, 'Cliente', 'Clientes')})` : 'Consultar a Receita'}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
