import { Fragment } from 'react'
import { CheckCircle2, Circle } from 'lucide-react'
import { RowActionButton } from '../ui/RowActionButton'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { useCustomerLookup } from '../../hooks/useCustomers'
import type { ReviewQueueItem } from '../../hooks/useReview'
import { canonicalizeValidCnpj } from '../../lib/cnpj'
import { formatCnpjCpf } from '../../lib/utils'
import { getReviewGroupCnpjEvidence, type ReviewGroup } from '../../pages/revisaoHelpers'

// Destaca no texto bruto o que parece CNPJ, com ou sem máscara. Só realça:
// a leitura canônica continua em `extractCnpjsFromText`.
const CNPJ_LIKE = /(\d{2}\.?\d{3}\.?\d{3}\/?\d{3,4}-?\d{2})/g

const SOURCE_TITLES = {
  manifesto: 'Manifesto',
  consignatario: 'Linha do consignatário',
  descricao: 'Descrição da carga',
} as const

function RawText({ value, empty, label }: { value: string | null | undefined; empty: string; label: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-xs font-medium text-[var(--app-muted)]">{label}</span>
      <pre className="m-0 min-h-[56px] whitespace-pre-wrap break-words rounded-[var(--app-radius-control)] border border-[var(--app-border-soft)] bg-[var(--app-bg)] px-3 py-2 font-mono text-xs">
        {value
          ? value.split(CNPJ_LIKE).map((part, index) => (index % 2 === 1
            ? <mark key={index} className="bg-[var(--app-warning-bg)] text-inherit">{part}</mark>
            : <Fragment key={index}>{part}</Fragment>))
          : <span className="text-[var(--app-muted)]">{empty}</span>}
      </pre>
    </div>
  )
}

/**
 * O texto bruto do B/L onde o Cliente aparece: a linha do consignatário e a
 * descrição da carga, lado a lado, com os CNPJs marcados. É o que o operador
 * lê quando o sistema não leu (ou leu mais de um) CNPJ.
 */
export function ReviewRawLines({ items }: { items: ReviewQueueItem[] }) {
  const bls = items.filter((item) => item.source === 'bl')
  return (
    <div className="grid gap-3">
      {bls.map((item) => (
        <div key={item.id} className="grid gap-3 md:grid-cols-2">
          <RawText label={`Linha do consignatário · B/L ${item.id}`} value={item.consignee_block} empty="Não extraída do B/L" />
          <RawText label="Descrição da carga" value={item.cargo_description} empty="Não extraída do B/L" />
        </div>
      ))}
    </div>
  )
}

function CandidateOwner({ cnpj }: { cnpj: string }) {
  const lookup = useCustomerLookup(cnpj)
  const owner = (lookup.data ?? []).find((customer) => canonicalizeValidCnpj(customer.cnpj_cpf) === cnpj)
  return owner ? <>{owner.name}</> : <NoValue label="Nenhum cliente cadastrado com este CNPJ" />
}

/**
 * Os CNPJs lidos no B/L quando são mais de um: onde cada um aparece e a quem
 * pertence no cadastro. "Usar este CNPJ" leva a escolha para o cadastro.
 */
export function ReviewCnpjCandidates({
  group,
  selectedCnpj,
  onUse,
}: {
  group: ReviewGroup
  selectedCnpj: string | null
  onUse: (cnpj: string) => void
}) {
  const evidence = new Map(getReviewGroupCnpjEvidence(group).map((entry) => [entry.cnpj, entry]))
  return (
    <table className="app-table app-table--nested">
      <caption className="sr-only">CNPJs lidos no B/L</caption>
      <thead>
        <tr>
          <th scope="col">CNPJ</th>
          <th scope="col" className="app-table__text-head">Onde foi lido</th>
          <th scope="col" className="app-table__text-head">Cadastro</th>
          <th scope="col"><span className="sr-only">Ação</span></th>
        </tr>
      </thead>
      <tbody>
        {group.candidateCnpjs.map((cnpj) => {
          const sources = [...new Set((evidence.get(cnpj)?.occurrences ?? []).map((o) => SOURCE_TITLES[o.source]))]
          const inUse = selectedCnpj === cnpj
          return (
            <tr key={cnpj}>
              <td><CopyValue value={cnpj} label="CNPJ">{formatCnpjCpf(cnpj)}</CopyValue></td>
              <td className="app-table__text">{sources.length ? sources.join(' e ') : 'B/L'}</td>
              <td className="app-table__text"><CandidateOwner cnpj={cnpj} /></td>
              <td>
                <RowActionButton
                  variant={inUse ? 'primary' : 'secondary'}
                  label={`Usar este CNPJ ${formatCnpjCpf(cnpj)}`}
                  icon={inUse ? CheckCircle2 : Circle}
                  title={inUse ? 'Em uso' : 'Usar este CNPJ'}
                  aria-pressed={inUse}
                  onClick={() => onUse(cnpj)}
                />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
