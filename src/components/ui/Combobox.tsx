import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type ComboOption = {
  value: string
  label: string
  meta?: string
}

export type ComboboxProps = {
  id?: string
  label: string
  /** Texto inicial exibido no campo (semeado uma vez). */
  initialValue?: string
  placeholder?: string
  /** Disparado (com debounce de 300ms) a cada digitacao — usado para filtrar. */
  onValueChange: (value: string) => void
  /** Carrega sugestoes em tempo real conforme o texto digitado. */
  fetchOptions: (query: string) => Promise<ComboOption[]>
  /** Disparado ao escolher uma sugestao da lista. */
  onSelectOption?: (option: ComboOption) => void
  /** Minimo de caracteres antes de buscar sugestoes. */
  minChars?: number
  /** Refaz a busca mantendo o texto quando a fonte de opcoes muda. */
  refreshKey?: string | number | boolean | null
  disabled?: boolean
}

const DEBOUNCE_MS = 300

// Campo de busca preditiva (combobox / typeahead). Auto-controlado: mantem o texto
// internamente e propaga as mudancas ja com debounce, evitando refazer a query a
// cada tecla.
export function Combobox({
  id,
  label,
  initialValue = '',
  placeholder,
  onValueChange,
  fetchOptions,
  onSelectOption,
  minChars = 1,
  refreshKey = null,
  disabled = false,
}: ComboboxProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const [text, setText] = useState(initialValue)
  const [touched, setTouched] = useState(false)
  const [options, setOptions] = useState<ComboOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const justSelectedRef = useRef(false)
  const onValueChangeRef = useRef(onValueChange)
  const fetchOptionsRef = useRef(fetchOptions)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const pointerSelectedValueRef = useRef<string | null>(null)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const listId = useId()
  const optionId = (index: number) => `${listId}-option-${index}`

  // Posiciona o dropdown em coordenadas de viewport (position: fixed) a partir do
  // input, para renderizá-lo num portal no body e escapar de `overflow:hidden` e
  // da sobreposição pelo card seguinte (#318).
  const updateMenuPosition = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setMenuStyle({ position: 'fixed', top: rect.bottom, left: rect.left, width: rect.width, zIndex: 9999 })
  }, [])

  useEffect(() => {
    onValueChangeRef.current = onValueChange
    fetchOptionsRef.current = fetchOptions
  })

  // Debounce unico: propaga o filtro e busca as sugestoes 300ms apos a ultima tecla.
  // Ignora o disparo inicial (estado semeado via initialValue/URL) para nao
  // sobrescrever filtros ja aplicados antes do usuario interagir.
  useEffect(() => {
    if (disabled || !touched) return
    if (justSelectedRef.current) {
      justSelectedRef.current = false
      return
    }
    const handle = window.setTimeout(() => {
      onValueChangeRef.current(text)
      const term = text.trim()
      if (term.length < minChars) {
        setOptions([])
        setLoading(false)
        return
      }
      setLoading(true)
      fetchOptionsRef
        .current(term)
        .then((result) => setOptions(result))
        .catch(() => setOptions([]))
        .finally(() => setLoading(false))
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [disabled, text, minChars, touched, refreshKey])

  // Fecha o dropdown ao clicar fora. O menu é portalado no body, então também
  // conta como "dentro" para não fechar antes do clique numa opção.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Reposiciona o menu enquanto aberto (abertura, mudança de opções, scroll de
  // qualquer ancestral, resize).
  useEffect(() => {
    if (!open) return
    updateMenuPosition()
    window.addEventListener('scroll', updateMenuPosition, true)
    window.addEventListener('resize', updateMenuPosition)
    return () => {
      window.removeEventListener('scroll', updateMenuPosition, true)
      window.removeEventListener('resize', updateMenuPosition)
    }
  }, [open, options.length, loading, updateMenuPosition])

  function handleSelect(option: ComboOption) {
    justSelectedRef.current = true
    setText(option.label)
    setOpen(false)
    setOptions([])
    setHighlight(-1)
    onSelectOption?.(option)
  }

  function handlePointerSelect(option: ComboOption) {
    pointerSelectedValueRef.current = option.value
    handleSelect(option)
    window.setTimeout(() => {
      if (pointerSelectedValueRef.current === option.value) pointerSelectedValueRef.current = null
    }, 0)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlight((current) => Math.min(current + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      if (open && highlight >= 0 && options[highlight]) {
        event.preventDefault()
        handleSelect(options[highlight])
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="app-field" ref={containerRef} style={{ position: 'relative' }}>
      <label htmlFor={inputId} className="app-field__label">{label}</label>
      <input
        id={inputId}
        ref={inputRef}
        className="app-input app-input--full"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && highlight >= 0 ? optionId(highlight) : undefined}
        autoComplete="off"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => {
          setTouched(true)
          setText(event.target.value)
          setOpen(true)
          setHighlight(-1)
        }}
        onFocus={() => {
          if (disabled) return
          if (options.length > 0) setOpen(true)
        }}
        onKeyDown={handleKeyDown}
      />
      {open && !disabled && (text.trim().length >= minChars)
        ? createPortal(
        <ul
          id={listId}
          ref={menuRef}
          role="listbox"
          className="app-combobox__list"
          style={menuStyle}
        >
          {loading ? (
            <li className="app-combobox__empty" role="status">Buscando…</li>
          ) : options.length === 0 ? (
            <li className="app-combobox__empty" role="status">Nenhuma sugestão</li>
          ) : (
            options.map((option, index) => (
              <li
                id={optionId(index)}
                key={`${option.value}-${index}`}
                role="option"
                aria-selected={index === highlight}
                className={`app-combobox__option${index === highlight ? ' app-combobox__option--active' : ''}`}
                onMouseDown={(event) => { event.preventDefault(); handlePointerSelect(option) }}
                onClick={() => {
                  if (pointerSelectedValueRef.current === option.value) {
                    pointerSelectedValueRef.current = null
                    return
                  }
                  handleSelect(option)
                }}
                onMouseEnter={() => setHighlight(index)}
              >
                  <span className="app-combobox__option-label">{option.label}</span>
                  {option.meta ? <span className="app-combobox__option-meta">{option.meta}</span> : null}
              </li>
            ))
          )}
        </ul>,
            document.body,
          )
        : null}
    </div>
  )
}
