import type { ReactNode } from 'react'

/**
 * Moldura das páginas públicas que o fwlog.com.br põe em iframe (ADR 0114):
 * sem menu, sem login e sem nada do Portal logado. Identidade Fwlog pelos
 * tokens do Portal; o nome do sistema interno nunca aparece aqui.
 */
export function PublicEmbedLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--app-bg)] px-4 py-6 text-[var(--app-text)]">
      <div className="mx-auto grid max-w-[1200px] gap-4">{children}</div>
      <p className="mx-auto mt-4 max-w-[1200px] text-xs text-[var(--app-muted)]">
        Informações publicadas pela Fwlog. Em caso de dúvida, fale com a Fwlog.
      </p>
    </main>
  )
}
