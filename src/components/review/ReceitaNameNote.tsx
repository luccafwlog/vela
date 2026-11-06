import { useEffect, useRef } from 'react'
import { useCnpjLookup } from '../../hooks/useCnpjLookup'

/** Compara razões sociais sem caixa, acento, pontuação e espaços repetidos. */
function sameCompanyName(a: string, b: string) {
  const key = (value: string) =>
    value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^0-9a-z]+/gi, ' ').trim().toUpperCase()
  return key(a) === key(b)
}

/**
 * Razão social da Receita no cadastro do Cliente pela Revisão (ADR 0126). O
 * cadastro da Revisão grava só razão social, CNPJ e e-mail, e a razão social
 * já chega preenchida com o nome do manifesto: vazia, recebe a da Receita (uma
 * vez por CNPJ); preenchida e diferente, a troca fica num botão, como "Usar
 * este CNPJ". `cnpj` é o CNPJ válido e aceito pelo formulário, ou `null`.
 */
export function ReceitaNameNote({ cnpj, name, onUseName }: {
  cnpj: string | null
  name: string
  onUseName: (name: string) => void
}) {
  const lookup = useCnpjLookup(cnpj)
  const result = cnpj ? lookup.data : undefined
  const found = result?.status === 'encontrado' ? result.data : null
  // O preenchimento da razão social vazia acontece uma vez por CNPJ: quem a
  // apaga depois não a vê voltar sozinha.
  const filledFor = useRef<string | null>(null)

  useEffect(() => {
    if (!found || !cnpj || filledFor.current === cnpj || name.trim()) return
    filledFor.current = cnpj
    onUseName(found.razao_social)
  }, [found, cnpj, name, onUseName])

  if (!cnpj) return null
  if (!result) {
    return lookup.isFetching ? <p className="m-0 text-[var(--app-muted)]" role="status">Buscando os dados na Receita…</p> : null
  }
  if (result.status === 'nao_encontrado') {
    return <p className="m-0 text-[var(--app-muted)]" role="status">CNPJ não encontrado na Receita. Confira a razão social à mão.</p>
  }
  if (result.status === 'indisponivel') {
    return <p className="m-0 text-[var(--app-muted)]" role="status">Consulta à Receita indisponível agora. Confira a razão social à mão.</p>
  }
  const situation = result.data.situacao && result.data.situacao !== 'ATIVA' ? ` Situação na Receita: ${result.data.situacao}.` : ''
  const differs = Boolean(name.trim()) && !sameCompanyName(name, result.data.razao_social)
  return (
    <p className="m-0 text-[var(--app-muted)]" role="status">
      {differs ? <>Na Receita: <strong>{result.data.razao_social}</strong>.</> : 'Razão social conferida na Receita.'}
      {situation}
      {differs ? (
        <>
          {' '}
          <button type="button" className="review-link-button" onClick={() => onUseName(result.data.razao_social)}>
            Usar a razão social da Receita
          </button>
        </>
      ) : null}
    </p>
  )
}
