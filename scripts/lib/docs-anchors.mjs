// Âncoras de seção no estilo do GitHub: o gate confere que `arquivo.md#secao`
// aponta para um título (ou `<a id>`) que existe no destino.

const fencePattern = /^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1/gm

export function stripCodeFences(markdown) {
  return markdown.replace(fencePattern, '')
}

// Mesmo algoritmo do github-slugger: minúsculas, remove pontuação e símbolos,
// troca cada espaço por hífen. Letras acentuadas, dígitos, `_` e `-` ficam.
// ponytail: a formatação inline é retirada por expressão regular; um título com
// ênfase em `_..._` mantém os sublinhados e pode divergir do slug renderizado.
// Melhoria: ler os títulos com um parser CommonMark (remark) e gerar o slug com
// `github-slugger`, quando aparecer o primeiro falso positivo ou negativo.
export function githubSlug(heading) {
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .trim()
    .toLowerCase()
  return text.replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-')
}

// Como o github-slugger: o sufixo -N pula qualquer slug já emitido, inclusive
// o de um título que já termina em "-1" (Foo, Foo-1, Foo → foo, foo-1, foo-2).
export function headingAnchors(markdown) {
  const anchors = new Set()
  const occurrences = new Map()
  const prose = stripCodeFences(markdown)
  for (const match of prose.matchAll(/^#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/gm)) {
    const base = githubSlug(match[1])
    let slug = base
    while (occurrences.has(slug)) {
      const next = occurrences.get(base) + 1
      occurrences.set(base, next)
      slug = `${base}-${next}`
    }
    occurrences.set(slug, 0)
    anchors.add(slug)
  }
  for (const match of prose.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(match[1])
  return anchors
}

export function anchorExists(anchors, fragment) {
  let decoded
  try {
    decoded = decodeURIComponent(fragment)
  } catch {
    return false
  }
  // O navegador compara o fragmento com o id exatamente; `#Notas` não leva a `notas`.
  return anchors.has(decoded)
}
