import { useState } from 'react'
import { Paperclip } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { openDisputeAttachment, type DisputeAttachment } from '../../services/demurrage/demurrageDisputes'

/**
 * Anexos de uma mensagem da Disputa, cada um com link para abrir ou baixar
 * (DEM-D01). Vela e Portal usam o mesmo bloco, cada um com o próprio cliente:
 * o Storage confere quem lê (bucket `demurrage-disputes`, migration 158).
 */
export function DisputeAttachmentLinks({ attachments, client, className }: {
  attachments: DisputeAttachment[]
  client: SupabaseClient
  className?: string
}) {
  const [failed, setFailed] = useState<number | null>(null)
  if (!attachments.length) return null
  return (
    <span className={className}>
      <Paperclip size={12} aria-hidden="true" />{' '}
      {attachments.map((attachment, index) => (
        <span key={attachment.id}>
          {index ? ', ' : null}
          <button
            type="button"
            className="app-link"
            onClick={() => {
              setFailed(null)
              openDisputeAttachment(client, attachment).catch(() => setFailed(attachment.id))
            }}
          >
            {attachment.file_name}
          </button>
          {failed === attachment.id ? <span role="alert"> (não foi possível abrir o anexo; tente de novo)</span> : null}
        </span>
      ))}
    </span>
  )
}
