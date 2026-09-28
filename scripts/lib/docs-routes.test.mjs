import assert from 'node:assert/strict'
import { appRouteIsDocumented, documentedRouteIsLive, extractDocRoutes, extractDocumentedRoutes } from './docs-routes.mjs'

const routes = extractDocRoutes(`<Routes>
  <Route element={<Guard />}><Route index element={<Home />} />
    <Route path='/inspect/:id/*' element={<Inspect />}>
      <Route index element={<Overview />} />
      <Route path={'billing'} element={<Billing />} />
    </Route>
    <Route path='*' element={<Missing />} />
  </Route>
</Routes>`)
assert.deepEqual(routes.map((route) => route.path), ['/', '/inspect/:id/*', '/inspect/:id', '/inspect/:id/billing', '*'])
assert.throws(() => extractDocRoutes('<Route path={dynamicPath} />'), /dynamic route/)

const documentedRoutes = extractDocumentedRoutes(`
| Rota / superfície | Ação |
|---|---|
| \`/inspect/:id/*\` | Tela ativa |
| \`/admin/prazo-adr\` | Aba ativa |
| \`/legacy\` | Sem rota própria; usa o catch-all |
`)
assert.deepEqual(documentedRoutes, ['/inspect/:id/*', '/admin/prazo-adr'])
assert.equal(documentedRouteIsLive('/admin/prazo-adr', new Set(['/admin/:tab'])), true)
assert.equal(documentedRouteIsLive('/missing', new Set(['/admin/:tab'])), false)
assert.equal(appRouteIsDocumented('/inspect/:id/billing', ['/inspect/:id/*']), false)
assert.equal(appRouteIsDocumented('/inspect/:id/billing', ['/inspect/:id/billing']), true)
console.log('docs-routes: nested, index, wildcard, literal, dynamic and bidirectional Markdown route checks passed.')
