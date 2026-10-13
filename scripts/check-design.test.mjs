import assert from 'node:assert/strict'
import { compare, countCssFamilies, countTsx, cssFamily } from './lib/design-rules.mjs'

// TSX: cada regra da identidade é contada; texto de domínio não é cor.
assert.deepEqual(
  countTsx('<span className="text-[11px] uppercase text-slate-400 bg-[#0d1117]" style={{ color: "#152238" }}>FAT-2026-0018 #1234</span>'),
  { hex: 2, 'tamanho-solto': 1, 'caixa-alta': 1, 'cor-tailwind': 1 },
)
assert.deepEqual(countTsx('<Block title="Carga"><LeadValue>0 de 2 devolvidos</LeadValue></Block>'), {})
assert.deepEqual(countTsx('const fonte = "Syne"'), { 'fonte-de-marca': 1 })
assert.deepEqual(countTsx('href="#exemplo" className="text-[var(--app-link)]"'), {})
// #RGBA também é cor escrita direto.
assert.deepEqual(countTsx('style={{ color: "#fff8" }} className="bg-[#fff8]"'), { hex: 2 })

// CSS: família pelos dois primeiros segmentos da primeira classe.
assert.equal(cssFamily('app-bl-cell__truncate'), 'app-bl')
assert.equal(cssFamily('review-items'), 'review-items')
assert.deepEqual(
  countCssFamilies(`
    /* .app-x { } comentário não conta */
    .app-bl-cell { color: red; }
    @media (max-width: 639px) { .app-bl-row, .app-bl-card { gap: 4px; } }
    .app-block__header { background: var(--app-strip); }
    :root { --app-bg: #f6f7f9; }
  `),
  { 'app-bl': 2, 'app-block': 1 },
)
// Seletor agrupado conta cada família uma vez: CSS de página junto de uma
// peça comum continua contando para a página.
assert.deepEqual(
  countCssFamilies('.app-block, .app-customer-new { gap: 4px; } .app-bl-row .app-btn, .app-bl-card { gap: 2px; }'),
  { 'app-block': 1, 'app-customer': 1, 'app-bl': 1 },
)

// Catraca: só aumento falha; queda é sugerida para travar o ganho.
const { increases, decreases } = compare(
  { 'src/pages/Bls.tsx': { hex: 2 }, 'src/index.css': { 'app-bl': 10 } },
  { 'src/pages/Bls.tsx': { hex: 1 }, 'src/pages/Nova.tsx': { 'caixa-alta': 1 }, 'src/index.css': { 'app-bl': 10, 'app-nova': 3 } },
)
assert.deepEqual(increases, [
  { scope: 'src/pages/Nova.tsx', key: 'caixa-alta', previous: 0, value: 1 },
  { scope: 'src/index.css', key: 'app-nova', previous: 0, value: 3 },
])
assert.deepEqual(decreases, [{ scope: 'src/pages/Bls.tsx', key: 'hex', previous: 2, value: 1 }])

console.log('check-design: ok')
