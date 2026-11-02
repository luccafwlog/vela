/**
 * Trava a rolagem da página enquanto um modal ou o menu do celular está
 * aberto; devolve a função que solta. Trava o `<html>`, que é quem rola a
 * janela: com `overflow-x: clip` no html (index.css), o overflow do body não
 * passa para a janela, e a página rolava por trás do modal. O body fica como
 * está: com `overflow: hidden` ele vira um contêiner de rolagem e o cabeçalho
 * fixo (sticky) saía da tela (2026-11-02). Aberturas aninhadas soltam na
 * ordem inversa.
 */
export function lockPageScroll(): () => void {
  const root = document.documentElement
  const previous = root.style.overflow
  root.style.overflow = 'hidden'
  return () => {
    root.style.overflow = previous
  }
}
