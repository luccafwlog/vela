import { useEffect, useRef } from 'react'
import { useCnpjLookup } from '../../hooks/useCnpjLookup'

/** Compara razões sociais sem caixa, acento, pontuação e espaços repetidos. */
function sameCompanyName(a: string, b: string) {
  const key = (value: string) =>
    value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^0-9a-z]+/gi, ' ').trim().toUpperCase()
  return key(a) === key(b)
}

/**
 * Dados da Receita no cadastro do Cliente pela Revisão (ADR 0126). A razão
 * social já chega preenchida com o nome do manifesto: vazia, recebe a da
 * Receita (uma vez por CNPJ); preenchida e diferente, a troca fica num botão,
 * como "Usar este CNPJ". O endereço não tem campo na Revisão: aparece aqui e
 * vai para o Cliente criado (`reviewProfileFromLookup`, migration 595).
 * `cnpj` é o CNPJ válido e aceito pelo formulário, ou `null`.
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
  const address = formatReceitaAddress(result.data)
  return (
    <div className="grid gap-1" role="status">
      <p className="m-0 text-[var(--app-muted)]">
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
      {address ? <p className="m-0 text-[var(--app-muted)]">Endereço da Receita, gravado no Cliente novo: {address}.</p> : null}
    </div>
  )
}

/** "RUA A, 10 - CENTRO, VITORIA/ES, CEP 29010-000", com o que a Receita tiver. */
function formatReceitaAddress(data: { endereco: string; cidade: string; uf: string; cep: string }) {
  const place = [data.cidade, data.uf].filter(Boolean).join('/')
  const zip = /^\d{8}$/.test(data.cep) ? `CEP ${data.cep.slice(0, 5)}-${data.cep.slice(5)}` : ''
  return [data.endereco, place, zip].filter(Boolean).join(', ')
}
