import { Download, ExternalLink } from 'lucide-react'
import { Block } from '../../ui/Block'
// O mesmo PDF que vai anexo no convite do Portal (portalInviteAttachments.ts):
// um arquivo só, em artifacts/portal-onboarding-cliente/. O build publica uma
// cópia com hash em /assets, então trocar o PDF lá troca o desta seção.
import tutorialPdfUrl from '../../../../artifacts/portal-onboarding-cliente/Tutorial_Portal_Fwlog.pdf?url'

export const PORTAL_TUTORIAL_FILENAME = 'Tutorial_Portal_Fwlog.pdf'

/**
 * Tutorial do Portal em Informações (pedido do dono de 2026-11-03): o
 * Cliente abre ou baixa o tutorial completo a qualquer momento, sem depender
 * do e-mail do convite. Não lê o catálogo da Central: o arquivo vem do build.
 */
export function TutorialSection() {
  return <Block title="Tutorial do Portal" aside="PDF">
    <div className="grid justify-items-start gap-3">
      <p className="m-0 text-sm">
        Passo a passo de cada tela do Portal: ativação do acesso, Painel, B/Ls e containers, Desbloqueio de CE, Faturas, pagamento por Pix, Demurrage, Informações e Meu perfil. É o mesmo tutorial enviado em anexo no convite.
      </p>
      <div className="flex flex-wrap gap-3">
        <a href={tutorialPdfUrl} target="_blank" rel="noopener noreferrer" className="app-btn app-btn--primary">
          Abrir tutorial<ExternalLink size={14} aria-hidden="true" />
        </a>
        <a href={tutorialPdfUrl} download={PORTAL_TUTORIAL_FILENAME} className="app-btn app-btn--secondary">
          <Download size={14} aria-hidden="true" />Baixar PDF
        </a>
      </div>
    </div>
  </Block>
}
