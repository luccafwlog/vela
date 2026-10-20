import { Check, Circle } from 'lucide-react'
import { capabilitiesFor, type Department } from '../../services/permissionMatrix'

/**
 * "Com este setor, ... pode" (lote 5b, opção C): o que a pessoa poderá fazer
 * com o setor escolhido, derivado do mesmo catálogo da matriz da aba Usuários.
 * Muda na hora ao trocar o setor, antes de salvar.
 */
export function SectorCapabilities({ department, personName }: { department: Department; personName?: string }) {
  const { shared, can, cannot } = capabilitiesFor(department)
  const who = personName?.trim().split(/\s+/)[0] || 'a pessoa'
  return (
    <section aria-label={`O que ${who} pode com este setor`} className="grid gap-2 text-sm">
      <p className="app-field__label">Com este setor, {who} pode</p>
      <ul className="grid gap-1">
        {[shared, ...can].map((text) => (
          <li key={text} className="flex items-start gap-2">
            <Check size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
      {cannot.length ? (
        <>
          <p className="app-field__label">Não pode</p>
          <ul className="grid gap-1 text-[var(--app-muted)]">
            {cannot.map((text) => (
              <li key={text} className="flex items-start gap-2">
                <Circle size={10} aria-hidden="true" className="mt-1 shrink-0" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
