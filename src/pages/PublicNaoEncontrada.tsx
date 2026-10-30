import { PublicEmbedLayout } from '../components/public/PublicEmbedLayout'
import { Block } from '../components/ui/Block'

/**
 * Caminho desconhecido sob /portal/publico/ (ADR 0114; revisão da PR #1119):
 * a página fica na moldura pública, sem `Navigate`. O `*` do Portal levaria o
 * iframe do fwlog.com.br ao login. Em produção a Pages Function já responde
 * 404 a esses caminhos; esta tela cobre a navegação dentro da própria SPA.
 */
export function PublicNaoEncontrada() {
  return (
    <PublicEmbedLayout>
      <Block title="Página não encontrada">
        <p>Este endereço não tem página. Confira o link ou fale com a Fwlog.</p>
      </Block>
    </PublicEmbedLayout>
  )
}
