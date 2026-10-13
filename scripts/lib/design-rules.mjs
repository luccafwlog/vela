// Regras verificáveis da identidade visual (ADR 0081, docs/identidade-visual.md).
// Funções puras: recebem texto e devolvem contagens, para o script e o teste.

/** Padrões proibidos em componentes e páginas (TSX). */
export const TSX_RULES = {
  // Cor escrita direto ("#152238", "bg-[#0d1117]", "#fff8"): use os tokens
  // --app-*. A forma #RGBA só conta com alguma letra, para "#1234" (número de
  // documento) não virar cor.
  hex: /(?<![\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|(?=\d*[a-fA-F])[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g,
  // Cor por função CSS ("rgb(255,0,0)", "text-[hsl(0,0%,10%)]"): use os
  // tokens. Nome de cor solto ("red") fica de fora: confunde com texto comum.
  'cor-funcao': /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g,
  // Tamanho de letra fora da escala ("text-[11px]").
  'tamanho-solto': /\btext-\[\d+(?:\.\d+)?px\]/g,
  // Caixa alta em rótulo, cabeçalho, tag ou aba.
  'caixa-alta': /\buppercase\b/g,
  // Cor da paleta do Tailwind fora dos tokens ("text-slate-400", "bg-red-50").
  'cor-tailwind': /\b(?:text|bg|border|ring|fill|stroke|from|to|divide|outline|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
  // Syne é só o nome "Vela", definido no CSS do shell.
  'fonte-de-marca': /\bSyne\b|app-font-brand|font-display\b/g,
}

export function countTsx(text) {
  const counts = {}
  for (const [rule, pattern] of Object.entries(TSX_RULES)) {
    const found = text.match(pattern)?.length ?? 0
    if (found) counts[rule] = found
  }
  return counts
}

/**
 * Família de uma classe de CSS: os dois primeiros segmentos
 * (".app-bl-cell__truncate" → "app-bl"). Famílias de página são as que cada
 * tela criou para si; a catraca não as deixa crescer.
 */
export function cssFamily(className) {
  const base = className.split('__')[0]
  return base.split('-').slice(0, 2).join('-')
}

/**
 * Conta blocos de regra por família, ignorando @media/@layer e comentários.
 * Cada família citada no seletor conta uma vez por regra, agrupada (".a, .b")
 * ou aninhada (".a .b"): pôr CSS de página dentro ou ao lado de uma peça
 * comum não esconde a família da página.
 */
export function countCssFamilies(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const counts = {}
  for (const match of withoutComments.matchAll(/([^{}]+)\{/g)) {
    const selector = match[1].trim()
    if (!selector || selector.startsWith('@')) continue
    const families = new Set()
    for (const match of selector.matchAll(/\.([A-Za-z][\w-]*)/g)) families.add(cssFamily(match[1]))
    for (const family of families) counts[family] = (counts[family] ?? 0) + 1
  }
  return counts
}

/**
 * Compara a contagem atual com a linha de base. Só aumento é falha: a linha de
 * base cai quando uma tela é migrada (npm run design:check -- --update).
 */
export function compare(baseline, current) {
  const increases = []
  const decreases = []
  for (const [scope, counts] of Object.entries(current)) {
    const before = baseline[scope] ?? {}
    for (const [key, value] of Object.entries(counts)) {
      const previous = before[key] ?? 0
      if (value > previous) increases.push({ scope, key, previous, value })
    }
  }
  for (const [scope, counts] of Object.entries(baseline)) {
    for (const [key, previous] of Object.entries(counts)) {
      const value = current[scope]?.[key] ?? 0
      if (value < previous) decreases.push({ scope, key, previous, value })
    }
  }
  return { increases, decreases }
}
