import { useState } from 'react'
import { Copy } from 'lucide-react'
import { APP_COMMIT_SHA, HAS_APP_COMMIT_SHA, formatAppVersion } from '../../lib/appVersion'

// Versão da build no menu da conta (etapa 02). Antes ela ocupava o canto
// direito da faixa de avisos em toda tela; o suporte continua a um clique:
// "qual versão você está vendo?" se responde abrindo o menu, e o clique copia
// o SHA completo para colar num chamado.
export function AppVersionBadge() {
  const [copied, setCopied] = useState(false)

  if (!HAS_APP_COMMIT_SHA) return null

  async function copy() {
    try {
      await navigator.clipboard.writeText(APP_COMMIT_SHA)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Sem permissão de clipboard o rótulo segue legível e selecionável:
      // o SHA completo continua no title.
    }
  }

  return (
    <button
      type="button"
      className="app-version-badge"
      onClick={() => void copy()}
      title={`Commit ${APP_COMMIT_SHA} — clique para copiar`}
      aria-label={`Versão da aplicação ${formatAppVersion()}. Copiar o commit completo.`}
    >
      <Copy size={14} aria-hidden="true" />
      <span>{copied ? 'Commit copiado' : `Versão ${formatAppVersion()}`}</span>
    </button>
  )
}
