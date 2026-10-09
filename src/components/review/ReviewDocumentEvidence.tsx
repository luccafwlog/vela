import { Fragment, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { formatCnpjCpf } from '../../lib/utils'
import {
  getReviewGroupCnpjEvidence,
  REVIEW_EVIDENCE_SOURCE_LABELS,
  type ReviewGroup,
} from '../../pages/revisaoHelpers'

// Destaca no texto bruto o que parece CNPJ, com ou sem máscara. Só realça:
// a leitura canônica continua em `extractCnpjsFromText`.
const CNPJ_LIKE = /(\d{2}\.?\d{3}\.?\d{3}\/?\d{3,4}-?\d{2})/g

function RawText({ value, empty }: { value: string | null | undefined; empty: string }) {
  if (!value) return <pre className="review-evidence__raw review-evidence__raw--empty">{empty}</pre>
  const parts = value.split(CNPJ_LIKE)
  return (
    <pre className="review-evidence__raw">
      {parts.map((part, index) => (index % 2 === 1
        ? <mark key={index} className="review-evidence__mark">{part}</mark>
        : <Fragment key={index}>{part}</Fragment>))}
    </pre>
  )
}

/**
 * O que o B/L diz sobre o cliente: os CNPJs encontrados, onde cada um aparece
 * e o texto original. Preserva a evidência bruta; quem decide é a pessoa,
 * escolhendo um CNPJ para o cadastro do grupo.
 */
export function ReviewDocumentEvidence({
  group,
  selectedCnpj = null,
  onUseCnpj,
}: {
  group: ReviewGroup
  selectedCnpj?: string | null
  onUseCnpj?: (cnpj: string) => void
}) {
  const blItems = group.items.filter((item) => item.source === 'bl')
  // Com um B/L só, o texto original já abre: é o que se compara com os CNPJs.
  const [open, setOpen] = useState<string | null>(blItems.length === 1 ? blItems[0].id : null)
  const evidence = new Map(getReviewGroupCnpjEvidence(group).map((entry) => [entry.cnpj, entry]))
  const candidates = group.candidateCnpjs

  return (
    <section className="review-evidence" aria-label="Evidências do B/L">
      <h3 className="review-section-title">O que o B/L diz</h3>
      {candidates.length ? (
        <ul className="review-evidence__candidates" aria-label="CNPJs encontrados">
          {candidates.map((cnpj) => {
            const occurrences = evidence.get(cnpj)?.occurrences ?? []
            const sources = [...new Set(occurrences.map((o) => REVIEW_EVIDENCE_SOURCE_LABELS[o.source]))]
            const inUse = selectedCnpj === cnpj
            return (
              <li key={cnpj} className="review-evidence__candidate">
                <div className="min-w-0">
                  <span className="review-code review-evidence__cnpj">{formatCnpjCpf(cnpj)}</span>
                  <span className="review-evidence__source">
                    {sources.length ? `Lido ${sources.join(' e ')}` : 'Lido no B/L'}
                    {blItems.length > 1 && occurrences.length ? ` · ${new Set(occurrences.map((o) => o.blId)).size} de ${blItems.length} B/Ls` : ''}
                  </span>
                </div>
                {onUseCnpj ? (
                  inUse ? <span className="review-evidence__in-use">Em uso no cadastro</span> : (
                    <button type="button" className="review-link-button" aria-label={`Usar este CNPJ ${formatCnpjCpf(cnpj)}`} onClick={() => onUseCnpj(cnpj)}>
                      Usar este CNPJ
                    </button>
                  )
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="review-evidence__none">Nenhum CNPJ rotulado foi encontrado no texto do B/L. Confira o original abaixo.</p>
      )}
      <div className="review-evidence__items">
        {blItems.map((item) => {
          const expanded = open === item.id
          return (
            <div key={item.id} className="review-evidence__item">
              <button type="button" className="review-evidence__item-toggle" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : item.id)}>
                <span className="min-w-0">
                  <strong className="review-evidence__item-id">Texto original do B/L {item.id}</strong>
                  <span className="review-evidence__item-summary">Consignatário: {item.consignee || 'não extraído'}</span>
                </span>
                <ChevronDown size={16} aria-hidden="true" className={`review-evidence__chevron ${expanded ? 'rotate-180' : ''}`} />
              </button>
              {expanded ? (
                <div className="review-evidence__raw-fields">
                  <div><span className="review-evidence__field-label">Campo consignatário</span><RawText value={item.consignee_block} empty="Não extraído" /></div>
                  <div><span className="review-evidence__field-label">Descrição da carga</span><RawText value={item.cargo_description} empty="Não extraída" /></div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
