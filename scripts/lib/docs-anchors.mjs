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
export function githubSlug(heading) {
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .trim()
    .toLowerCase()
  return text.replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-')
}

export function headingAnchors(markdown) {
  const anchors = new Set()
  const seen = new Map()
  const prose = stripCodeFences(markdown)
  for (const match of prose.matchAll(/^#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/gm)) {
    const slug = githubSlug(match[1])
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    anchors.add(count === 0 ? slug : `${slug}-${count}`)
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
  return anchors.has(decoded) || anchors.has(decoded.toLowerCase())
}
