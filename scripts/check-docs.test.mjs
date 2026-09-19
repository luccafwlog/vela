import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
try {
  for (const file of ['scripts/check-docs.mjs', 'scripts/lib/docs-routes.mjs']) write(file, fs.readFileSync(path.join(root, file)))
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir')
  write('AGENTS.md', '# Agent rules\n')
  write('docs/README.md', '# Docs\n')
  write('docs/adr/0001-example.md', '# Decision\n')
  write('docs/adr/README.md', '[Decision](0001-example.md)\n')
  for (const name of ['viagens', 'manifesto-edi', 'granito', 'chegadas-saidas', 'clientes', 'taxas-locais', 'faturamento', 'demurrage', 'reconciliacao-pix', 'portal-cliente', 'operacao-suporte']) write(`docs/modules/${name}.md`, moduleText)
  write('src/AppInterno.tsx', '<Routes><Route index /><Route path="/inspect/:id/*"><Route path="billing" /></Route></Routes>')
  write('src/AppPortal.tsx', '<Routes><Route path="/portal" /><Route path="*" /></Routes>')
  const routes = '`/` `/inspect/:id/*` `billing` `/inspect/:id/billing` `/portal` `*`'
  write('docs/ARCHITECTURE.md', routes)
  write('docs/RASTREABILIDADE.md', `${routes}\n**Código** **Teste** **Runtime** **Suspeita**`)
  assert.equal(run().status, 0)
  write('docs/modules/viagens.md', moduleText.replace(' | Falhas', ''))
  assert.match(run().stderr, /eight-column|noncanonical columns/)
  write('docs/modules/viagens.md', moduleText.replace('## Estado e dados', '## Extra'))
  assert.match(run().stderr, /seven canonical sections/)
  write('docs/modules/viagens.md', moduleText)
  write('docs/ARCHITECTURE.md', routes.replace('`/inspect/:id/billing`', ''))
  assert.match(run().stderr, /\/inspect\/:id\/billing/)
  write('docs/ARCHITECTURE.md', routes)
  write('docs/adr/README.md', '# Index\n')
  assert.match(run().stderr, /ADR is not indexed/)
  write('docs/adr/README.md', '[Decision](0001-example.md)\n')
  write('docs/README.md', '[Broken](missing.md)\n')
  assert.match(run().stderr, /broken relative link/)
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
  console.log('check-docs: positive fixture and eight rejection scenarios passed.')
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}
