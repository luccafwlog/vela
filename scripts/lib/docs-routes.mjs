import ts from 'typescript'

/** Extract declared and resolved JSX routes, including index and nested routes. */
export function extractDocRoutes(source, filename = 'routes.tsx') {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const routes = []
  function visit(node, parent = '') {
    const opening = ts.isJsxElement(node) ? node.openingElement
      : ts.isJsxSelfClosingElement(node) ? node : null
    if (opening?.tagName.getText(file) === 'Route') {
      const attributes = opening.attributes.properties
      const attribute = (name) => attributes.find((item) => ts.isJsxAttribute(item) && item.name.text === name)
      const pathAttribute = attribute('path')
      let declared = pathAttribute?.initializer
      if (declared && ts.isJsxExpression(declared)) declared = declared.expression
      if (pathAttribute && (!declared || !ts.isStringLiteral(declared))) {
        throw new Error(`${filename}: dynamic route path requires explicit documentation extraction`)
      }
      const value = declared?.text
      const route = value?.startsWith('/') || value === '*' ? value
        : value ? `${parent.replace(/\/\*$/, '').replace(/\/$/, '')}/${value}`
          : parent.replace(/\/\*$/, '') || '/'
      if (value !== undefined || attribute('index')) {
        routes.push({ declared: value ?? route, path: route })
      }
      if (ts.isJsxElement(node)) node.children.forEach((child) => visit(child, route))
      return
    }
    ts.forEachChild(node, (child) => visit(child, parent))
  }
  visit(file)
  return routes
}

/** Extract routes from Markdown tables whose first column is a route/surface. */
export function extractDocumentedRoutes(markdown) {
  const routes = new Set()
  let inRouteTable = false

  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) {
      inRouteTable = false
      continue
    }

    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    const firstCell = cells[0] ?? ''
    if (/^Rota(?:\b|\/)/i.test(firstCell)) {
      inRouteTable = true
      continue
    }
    if (!inRouteTable || /sem rota própria|não há rota nem página dedicada/i.test(line)) continue

    for (const [, route] of firstCell.matchAll(/`([^`]+)`/g)) {
      if (route === '*' || route.startsWith('/')) routes.add(route)
    }
  }

  return [...routes]
}

/** Check whether a documented path still resolves through a live route. */
export function documentedRouteIsLive(documentedRoute, appRoutes) {
  const documentedPath = documentedRoute.split('?')[0].replace(/\/$/, '') || '/'
  if (documentedPath === '*') return appRoutes.has('*')
  if (appRoutes.has(documentedPath)) return true

  if (documentedPath.endsWith('/*')) {
    const base = documentedPath.slice(0, -2)
    return [...appRoutes].some((route) => route === base || route.startsWith(`${base}/`))
  }

  return [...appRoutes].some((route) => routePatternMatches(route, documentedPath))
}

/** Check whether an app route is explicitly represented in a route table. */
export function appRouteIsDocumented(appRoute, documentedRoutes) {
  if (appRoute === '*') return documentedRoutes.includes('*')

  return documentedRoutes.some((route) => {
    const documentedPath = route.split('?')[0].replace(/\/$/, '') || '/'
    if (documentedPath === appRoute) return true
    return false
  })
}

function routePatternMatches(pattern, candidate) {
  if (pattern === '*') return candidate === '*'

  const patternParts = pattern.split('/').filter(Boolean)
  const candidateParts = candidate.split('/').filter(Boolean)
  let index = 0

  for (; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index]
    if (patternPart === '*') return index === patternParts.length - 1 && candidateParts.length >= index
    const candidatePart = candidateParts[index]
    if (!candidatePart) return false
    if (!patternPart.startsWith(':') && patternPart !== candidatePart) return false
  }

  return patternParts.length === candidateParts.length
}
