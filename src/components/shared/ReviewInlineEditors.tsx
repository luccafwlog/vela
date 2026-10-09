import { useId, useState, type KeyboardEvent } from 'react'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { useCustomerLookup } from '../../hooks/useCustomers'
import type { ReviewCustomer } from '../../hooks/useReview'
import { canonicalizeValidCnpj } from '../../lib/cnpj'
import { formatCnpjCpf } from '../../lib/utils'

// Editores inline da fila de revisão; salvamento e seleção ficam com o pai.

/**
 * Busca de cliente cadastrado com lista de sugestões navegável por teclado.
 * Com `expectedCnpjs`, cada sugestão diz se o CNPJ confere com o que foi lido
 * no B/L, para o vínculo não ser feito sem comparar o documento.
 */
export function InlineCustomerPicker({
  saving,
  onSelect,
  label = 'Buscar cliente cadastrado',
  expectedCnpjs = [],
}: {
  saving: boolean
  onSelect: (customer: ReviewCustomer) => void
  label?: string
  expectedCnpjs?: string[]
}) {
  const [search, setSearch] = useState('')
  const [highlight, setHighlight] = useState(-1)
  const lookup = useCustomerLookup(search)
  const options = lookup.data ?? []
  const inputId = useId()
  const listId = useId()
  const searching = search.trim().length >= 2
  const showEmpty = searching && !lookup.isFetching && options.length === 0 && lookup.isFetched

  function choose(customer: ReviewCustomer) {
    if (saving) return
    onSelect(customer)
    setSearch('')
    setHighlight(-1)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!options.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((current) => Math.min(current + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter' && highlight >= 0 && options[highlight]) {
      event.preventDefault()
      choose(options[highlight])
    } else if (event.key === 'Escape') {
      setHighlight(-1)
      setSearch('')
    }
  }

  return (
    <div className="review-picker">
      <label htmlFor={inputId} className="app-field__label">{label}</label>
      <Input
        id={inputId}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value)
          setHighlight(-1)
        }}
        onKeyDown={onKeyDown}
        placeholder="Nome ou CNPJ do cliente"
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={options.length ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
        autoComplete="off"
        disabled={saving}
      />
      {lookup.isFetching && searching ? <p className="review-picker__status" role="status">Buscando…</p> : null}
      {showEmpty ? <p className="review-picker__status" role="status">Nenhum cliente encontrado com “{search.trim()}”.</p> : null}
      {options.length ? (
        <ul id={listId} role="listbox" aria-label="Clientes encontrados" className="review-picker__list">
          {options.map((customer, index) => {
            const canonical = canonicalizeValidCnpj(customer.cnpj_cpf)
            const match = expectedCnpjs.length > 0 && canonical ? expectedCnpjs.includes(canonical) : null
            return (
              <li
                id={`${listId}-${index}`}
                key={customer.id}
                role="option"
                aria-selected={index === highlight}
                aria-disabled={saving || undefined}
                className={`review-picker__option${index === highlight ? ' review-picker__option--active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(customer)}
                onMouseEnter={() => setHighlight(index)}
              >
                <span className="review-picker__name">{customer.name}</span>
                <span className="review-picker__meta">
                  <span className="review-code">{formatCnpjCpf(customer.cnpj_cpf)}</span>
                  {match === true ? <span className="review-picker__match review-picker__match--ok">CNPJ confere com o B/L</span> : null}
                  {match === false ? <span className="review-picker__match review-picker__match--diff">CNPJ diferente do B/L</span> : null}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * Campo isolado com salvamento por linha. Enter grava, Escape volta ao valor
 * inicial e o erro aparece junto do campo, não em toast.
 */
export function InlineFieldEditor({
  type,
  placeholder,
  initial,
  saving,
  onSave,
  label,
  validate,
}: {
  /**
   * `decimal` aceita vírgula: um `<input type="number">` descarta "12,5" antes
   * do validador ver o valor, e o erro diria que o campo está vazio.
   */
  type: 'text' | 'number' | 'decimal'
  placeholder: string
  initial: string
  saving: boolean
  onSave: (value: string) => void
  /** Nome acessível do campo; sem ele, o placeholder faz esse papel. */
  label?: string
  /** Mensagem de erro para o valor, ou `null` quando está válido. */
  validate?: (value: string) => string | null
}) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()

  function submit() {
    const problem = validate?.(value) ?? null
    setError(problem)
    if (problem) return
    onSave(value)
  }

  return (
    <div className="review-inline-field">
      <div className="review-inline-field__row">
        <Input
          type={type === 'decimal' ? 'text' : type}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            } else if (event.key === 'Escape') {
              setValue(initial)
              setError(null)
            }
          }}
          placeholder={placeholder}
          aria-label={label ?? placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          inputMode={type === 'text' ? undefined : 'decimal'}
          className="review-inline-field__input w-32"
          disabled={saving}
        />
        <Button variant="secondary" className="app-btn--sm" loading={saving} loadingLabel="Salvando…" onClick={submit}>
          Salvar
        </Button>
      </div>
      {error ? <p id={errorId} className="review-inline-field__error" role="alert">{error}</p> : null}
    </div>
  )
}
