import type { ReactNode } from 'react'

/**
 * Faixa de salvar no pé de um bloco do Perfil: diz se há alteração pendente e
 * leva o botão principal do bloco, à direita.
 */
export function ProfileSaveBar({ status, children }: { status?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--app-border-soft)] pt-3">
      {status ? <p className="m-0 mr-auto text-sm text-[var(--app-muted)]" aria-live="polite">{status}</p> : null}
      {children}
    </div>
  )
}
