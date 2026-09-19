import assert from 'node:assert/strict'
import { extractDocRoutes } from './docs-routes.mjs'

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
console.log('docs-routes: nested, index, wildcard, literal expression and dynamic-path checks passed.')
