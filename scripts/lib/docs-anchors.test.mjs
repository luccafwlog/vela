import assert from 'node:assert/strict'
import { anchorExists, githubSlug, headingAnchors, stripCodeFences, stripNonRendered } from './docs-anchors.mjs'

assert.equal(githubSlug('Câmbio (ROE / PTAX)'), 'câmbio-roe--ptax')
assert.equal(githubSlug('Admin / Usuários'), 'admin--usuários')
assert.equal(githubSlug('`agency_departure_report` — ADR'), 'agency_departure_report--adr')
assert.equal(githubSlug('Ver [ADR 0081](../adr/0081-x.md)'), 'ver-adr-0081')
assert.equal(githubSlug('Régua de cobrança'), 'régua-de-cobrança')

const anchors = headingAnchors([
  '# Módulo',
  '## Notas',
  '### Notas',
  '<a id="line-up"></a>',
  '```md',
  '## Dentro do bloco',
  '```',
  '  ~~~',
  '## Também dentro',
  '  ~~~',
].join('\n'))
assert.deepEqual([...anchors].sort(), ['line-up', 'módulo', 'notas', 'notas-1'])
const commented = headingAnchors('## Visível\n<!--\n## Escondido\n-->\n```html\n<!-- não abre comentário\n```\n## Depois\n')
assert.deepEqual([...commented].sort(), ['depois', 'visível'])
assert.equal(stripNonRendered('a <!-- b --> c'), 'a  c')
const collided = headingAnchors('## Foo\n## Foo-1\n## Foo\n## Foo\n')
assert.deepEqual([...collided].sort(), ['foo', 'foo-1', 'foo-2', 'foo-3'])
assert.equal(stripCodeFences('a\n```\n## x\n```\nb').includes('## x'), false)

assert.equal(anchorExists(anchors, 'notas-1'), true)
assert.equal(anchorExists(anchors, 'm%C3%B3dulo'), true)
assert.equal(anchorExists(anchors, 'Notas'), false)
assert.equal(anchorExists(anchors, 'dentro-do-bloco'), false)
assert.equal(anchorExists(anchors, '%E0%A4%A'), false)

console.log('docs-anchors: GitHub slug, duplicate suffix with collisions, code fence, HTML comment and explicit anchor checks passed.')
