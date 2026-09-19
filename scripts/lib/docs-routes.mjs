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
