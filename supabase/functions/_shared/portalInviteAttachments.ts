// Anexo de todo e-mail de convite e de reenvio do Portal: o tutorial completo
// do material do Cliente (artifacts/portal-onboarding-cliente/). Vem do módulo
// gerado, que sobe com a função: o anexo não depende de download nem de outro
// site. Trocar o PDF é gerá-lo de novo, rodar
// scripts/generate-portal-invite-pdfs.mjs e publicar.
import type { EmailAttachment } from './email.ts'
import { PORTAL_TUTORIAL_PDF_BASE64 } from './portalInvitePdfs.generated.ts'

export const PORTAL_INVITE_ATTACHMENTS: readonly EmailAttachment[] = [
  { filename: 'Tutorial_Portal_Fwlog.pdf', content: PORTAL_TUTORIAL_PDF_BASE64, contentType: 'application/pdf' },
]
