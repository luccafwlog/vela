import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-docs-check-'))
const write = (name, value) => {
  fs.mkdirSync(path.dirname(path.join(fixture, name)), { recursive: true })
  fs.writeFileSync(path.join(fixture, name), value)
}
const run = () => spawnSync(process.execPath, [path.join(fixture, 'scripts/check-docs.mjs')], { encoding: 'utf8' })
const headings = ['Propósito e escopo', 'Anatomia das telas', 'Catálogo de ações', 'Estado e dados', 'Fluxos e invariantes', 'Testes e validação', 'Notas e divergências']
const catalog = '| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |'
const moduleText = headings.map((heading) => `## ${heading}\n${heading === 'Catálogo de ações' ? catalog : ''}\n`).join('\n')
const routes = ['/', '/inspect/:id/*', '/inspect/:id', '/inspect/:id/billing', '/portal', '*']
const architectureFor = (mappedRoutes) => [
  '## Mapa de rotas',
  '| Rota | Destino |',
  '|---|---|',
  ...mappedRoutes.map((route) => `| \`${route}\` | Rota ativa |`),
  '| `/legacy` | Sem rota própria; removida do roteador |',
].join('\n')
const traceabilityFor = (mappedRoutes) => [
  '## Índice por rota e ação',
  '| Rota / superfície | Ação |',
  '|---|---|',
  ...mappedRoutes.map((route) => `| \`${route}\` | Ação mapeada |`),
  '| `/legacy` | Não há rota nem página dedicada; usa o catch-all |',
  '**Código** **Teste** **Runtime** **Suspeita**',
].join('\n')
const adrIndexWith = (status) => `| ADR | Decisão | Status |\n|---|---|---|\n| [0001](0001-example.md) | Decision | ${status} |\n`
try {
  write('scripts/check-docs.mjs', fs.readFileSync(path.join(root, 'scripts/check-docs.mjs')))
  const routeHelper = fs.readFileSync(path.join(root, 'scripts/lib/docs-routes.mjs'), 'utf8')
    .replace("from 'typescript'", `from '${pathToFileURL(path.join(root, 'node_modules/typescript/lib/typescript.js')).href}'`)
  write('scripts/lib/docs-routes.mjs', routeHelper)
  write('scripts/lib/docs-adr.mjs', fs.readFileSync(path.join(root, 'scripts/lib/docs-adr.mjs')))
  // O fixture fica fora do repositório: os pacotes do parser são importados
  // pelo caminho do node_modules do repositório.
  const anchorsHelper = fs.readFileSync(path.join(root, 'scripts/lib/docs-anchors.mjs'), 'utf8')
    .replace(/from '([a-z][^'./]*)'/g, (_match, name) => `from '${import.meta.resolve(name)}'`)
  write('scripts/lib/docs-anchors.mjs', anchorsHelper)
  write('AGENTS.md', '# Agent rules\n')
  write('docs/README.md', '# Docs\n')
  write('docs/adr/0001-example.md', '# Decision\n\nStatus: aceito — 2026-01-01\n')
  write('docs/adr/README.md', adrIndexWith('aceito'))
  for (const name of ['viagens', 'manifesto-edi', 'granito', 'chegadas-saidas', 'clientes', 'taxas-locais', 'faturamento', 'demurrage', 'reconciliacao-pix', 'desbloqueio-ce', 'portal-cliente', 'operacao-suporte']) write(`docs/modules/${name}.md`, moduleText)
  write('src/AppInterno.tsx', '<Routes><Route index /><Route path="/inspect/:id/*"><Route path="billing" /></Route></Routes>')
  write('src/AppPortal.tsx', '<Routes><Route path="/portal" /><Route path="*" /></Routes>')
  write('docs/ARCHITECTURE.md', architectureFor(routes))
  write('docs/RASTREABILIDADE.md', traceabilityFor(routes))
  assert.equal(run().status, 0)
  write('docs/modules/viagens.md', moduleText.replace(' | Falhas', ''))
  assert.match(run().stderr, /eight-column|noncanonical columns/)
  write('docs/modules/viagens.md', moduleText.replace('## Estado e dados', '## Extra'))
  assert.match(run().stderr, /seven canonical sections/)
  write('docs/modules/viagens.md', moduleText)
  write('docs/ARCHITECTURE.md', architectureFor(routes.filter((route) => route !== '/inspect/:id/billing')))
  assert.match(run().stderr, /route from AppInterno\/AppPortal is missing from the route map: \/inspect\/:id\/billing/)
  write('docs/ARCHITECTURE.md', architectureFor([...routes, '/removed']))
  assert.match(run().stderr, /documented route is not present in AppInterno\/AppPortal: \/removed/)
  write('docs/ARCHITECTURE.md', architectureFor(routes))
  write('docs/RASTREABILIDADE.md', traceabilityFor([...routes, '/removed']))
  assert.match(run().stderr, /documented route is not present in AppInterno\/AppPortal: \/removed/)
  write('docs/RASTREABILIDADE.md', traceabilityFor(routes))
  write('docs/adr/README.md', '# Index\n')
  assert.match(run().stderr, /ADR is not indexed/)
  write('docs/adr/README.md', 'Ver [Decision](0001-example.md).\n')
  assert.match(run().stderr, /ADR has no row in the index table: 0001-example\.md/)
  write('docs/adr/README.md', `${adrIndexWith('aceito')}\nVer também [Outra](0001-other.md).\n`)
  write('docs/adr/0001-other.md', '# Outra\n\nStatus: aceito — 2026-01-01\n')
  const duplicated = run().stderr
  assert.match(duplicated, /ADR number 0001 is used by more than one file: 0001-example\.md, 0001-other\.md/)
  assert.match(duplicated, /ADR has no row in the index table: 0001-other\.md/)
  fs.unlinkSync(path.join(fixture, 'docs/adr/0001-other.md'))
  write('docs/adr/README.md', `${adrIndexWith('aceito')}| [0001](0001-example.md) | Decision | supersedida parcialmente |\n`)
  assert.match(run().stderr, /ADR has more than one row in the index table: 0001-example\.md/)
  write('docs/adr/README.md', adrIndexWith('aceito'))
  write('docs/adr/README.md', adrIndexWith('supersedida parcialmente'))
  assert.match(run().stderr, /ADR status "aceito" differs from the index \("supersedida parcialmente"\)/)
  write('docs/adr/0001-example.md', '# Decision\n\nStatus: supersedida parcialmente — 2026-01-01\n')
  assert.match(run().stderr, /needs a "> \*\*Situação atual/)
  write('docs/adr/0001-example.md', '# Decision\n\n> **Situação atual (2026-10-13).** Regra vigente no módulo.\n\nStatus: supersedida parcialmente — 2026-01-01\n')
  assert.equal(run().status, 0)
  write('docs/adr/0001-example.md', '# Decision\n\nDecidido.\n')
  assert.match(run().stderr, /no recognizable "Status:" line/)
  write('docs/adr/0001-example.md', '> **Situação atual (2026-10-13).** Sem título.\n\nStatus: aceito — 2026-01-01\n')
  assert.match(run().stderr, /ADR has no "# " title line/)
  write('docs/adr/0001-example.md', '# Decision\n\nStatus: aceito — 2026-01-01\n')
  write('docs/adr/README.md', adrIndexWith('aceito'))
  write('docs/skills/inventory-2026-09-18.md', '# Inventory\n')
  assert.match(run().stderr, /dated document must live in docs\/archive/)
  fs.unlinkSync(path.join(fixture, 'docs/skills/inventory-2026-09-18.md'))
  write('docs/plans/2026-10-13-plano.md', '# Plano vivo\n')
  assert.equal(run().status, 0)
  write('docs/README.md', '[Broken](missing.md)\n')
  assert.match(run().stderr, /broken relative link/)
  write('docs/README.md', '# Docs\n\n## Régua\n\n[Seção](#régua) [Módulo](modules/viagens.md#catálogo-de-ações) [Linha](../src/AppPortal.tsx#L1)\n')
  assert.equal(run().status, 0)
  write('docs/README.md', '# Docs\n\n[Seção](modules/viagens.md#secao-removida)\n')
  assert.match(run().stderr, /missing section anchor: modules\/viagens\.md#secao-removida/)
  write('docs/README.md', '# Docs\n\n[Seção](#inexistente)\n')
  assert.match(run().stderr, /missing section anchor: #inexistente/)
  write('docs/README.md', '# Docs\n\n<!-- [antigo](#removido) [sumiu](missing.md) -->\n~~~md\n[exemplo](#tambem-nao)\n~~~\n')
  assert.equal(run().status, 0)
  write('docs/README.md', '# Docs\n')
  fs.unlinkSync(path.join(fixture, 'AGENTS.md'))
  assert.match(run().stderr, /AGENTS.md: required/)
  write('AGENTS.md', '# Agent rules\n')
  write('CLAUDE.md', '# Legacy\n')
  assert.match(run().stderr, /legacy root file still exists/)
  fs.unlinkSync(path.join(fixture, 'CLAUDE.md'))
  write('src/AppInterno.tsx', '<Routes><Route path={DYNAMIC_ROUTE} /></Routes>')
  const dynamic = run()
  assert.notEqual(dynamic.status, 0)
  assert.match(dynamic.stderr, /dynamic route path requires explicit documentation extraction/)
  assert.doesNotMatch(dynamic.stderr, /at checkDocs|file:\/\//)
  write('src/AppInterno.tsx', '<Routes><Route index /><Route path="/inspect/:id/*"><Route path="billing" /></Route></Routes>')
  assert.equal(run().status, 0)
  console.log('check-docs: positive fixture and twenty rejection scenarios passed.')
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}
