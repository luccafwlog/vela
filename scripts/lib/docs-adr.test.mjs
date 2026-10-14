import assert from 'node:assert/strict'
import { adrFileStatus, adrNeedsBanner, hasSituationBanner, isDatedLivingDocument, parseAdrIndex } from './docs-adr.mjs'

assert.equal(adrFileStatus('# 0001 — X\n\nStatus: supersedida parcialmente — 2026-06-03\n'), 'supersedida parcialmente')
assert.equal(adrFileStatus('# 0050 — X\n\n**Status:** aceito\n'), 'aceito')
assert.equal(adrFileStatus('# 0044 — X\n\nStatus: substituída pela ADR 0046 — 2026-08-13\n'), 'substituída')
assert.equal(adrFileStatus('# 0081 — X\n\n**Data:** 2026-10-13 · **Status:** aceito\n'), 'aceito')
assert.equal(adrFileStatus('# 0011 — X\n\nDecidido em junho.\n'), null)
assert.equal(adrFileStatus('# 0012 — X\n\nO Status: aceito foi discutido.\n'), null)

assert.equal(hasSituationBanner('# X\n\n> **Situação atual (2026-10-13).** A regra vigente está no módulo.\n'), true)
assert.equal(hasSituationBanner('# X\n\n> **Nota editorial — 2026-09-23.** Algo mudou.\n'), false)
assert.equal(hasSituationBanner('# X\n\nStatus: estendida\n\n> **Situação atual (2026-10-13).** Tarde demais.\n'), false)
assert.equal(hasSituationBanner('# X\n\n## Contexto\n\n> **Situação atual (2026-10-13).** Citada no corpo.\n'), false)
assert.equal(adrNeedsBanner('aceito'), false)
assert.equal(adrNeedsBanner('estendida'), true)
assert.equal(adrNeedsBanner('supersedida parcialmente'), true)

const index = parseAdrIndex([
  '| ADR | Decisão | Status | Implementação | Regra vigente em | Relações |',
  '|---|---|---|---|---|---|',
  '| [0001](./0001-a.md) | A \\| B | supersedida parcialmente | implementada | módulo | 0013 |',
  '| [0003](./0003-b.md) | C | aceito | implementada | módulo | — |',
  '',
  '| Outra | Tabela |',
  '|---|---|',
  '| [0009](./0009-c.md) | não é linha do índice |',
].join('\n'))
assert.deepEqual([...index.entries()], [['0001', 'supersedida parcialmente'], ['0003', 'aceito']])

assert.equal(isDatedLivingDocument('docs/skills/skill-audit-2026-09-18.md'), true)
assert.equal(isDatedLivingDocument('docs/research/2026-09-10-br-code-pix-estatico.md'), true)
assert.equal(isDatedLivingDocument('docs/plans/2026-10-13-revisao-geral-documentacao.md'), false)
assert.equal(isDatedLivingDocument('docs/spec/2026-10-04-desbloqueio-ce-mercante-design.md'), false)
assert.equal(isDatedLivingDocument('docs/archive/audits/2026-09-19-overhaul-documental.md'), false)
assert.equal(isDatedLivingDocument('docs/modules/viagens.md'), false)

console.log('docs-adr: status line, banner below the title, index column lookup and dated-document placement checks passed.')
