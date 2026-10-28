// Roda dentro da página montada, antes da impressão: dá a cada bloco do
// texto a estrutura das páginas-modelo (fatos, passos numerados, cartões com
// "O que o sistema faz / Por quê / O que você faz", ícones dos quadros).
/* global document */
;(() => {
  const ICONES = {
    sozinho: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    atencao: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    'nao-faca': '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    porque: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    erro: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  }
  for (const span of document.querySelectorAll('span.icone')) {
    const tipo = [...span.classList].find((c) => c.startsWith('icone--')).slice(7)
    span.outerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${ICONES[tipo]}</svg>`
  }

  // Item "**Rótulo:** valor" → par rótulo/valor.
  function pares(lista) {
    return [...lista.children].map((li) => {
      const forte = li.querySelector(':scope > strong:first-child, :scope > p:first-child > strong:first-child')
      if (!forte) throw new Error(`Item sem rótulo em negrito: ${li.textContent.slice(0, 60)}`)
      const rotulo = forte.textContent.replace(/:\s*$/, '')
      forte.remove()
      return { rotulo, valor: li.innerHTML.replace(/^\s*(<p>)?\s*/, '$1') }
    })
  }

  for (const lista of document.querySelectorAll('.ficha .conteudo > ul')) {
    const grade = document.createElement('div')
    grade.className = 'fatos'
    grade.innerHTML = pares(lista)
      .map((p) => `<div class="fato"><span class="rotulo">${p.rotulo}</span><div class="valor">${p.valor}</div></div>`)
      .join('')
    lista.replaceWith(grade)
  }

  for (const lista of document.querySelectorAll('.corpo-card > ul')) {
    const dl = document.createElement('dl')
    dl.innerHTML = pares(lista).map((p) => `<dt>${p.rotulo}</dt><dd>${p.valor}</dd>`).join('')
    lista.replaceWith(dl)
  }

  for (const lista of document.querySelectorAll('.passos-bloco ol, .colunas-passos ol')) {
    lista.classList.add('passos')
    let n = Number(lista.getAttribute('start') || 1)
    for (const li of lista.children) {
      li.innerHTML = `<span class="n">${n}</span><span>${li.innerHTML}</span>`
      n += 1
    }
  }
})()
