// Títulos do build do Portal. Mantém a marca Fwlog fora do app interno e
// permite que o artefato do cliente seja auditado sem carregar Vela.
const BASE = 'Fwlog'

const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/portal\/publico\/chegadas-saidas\/?$/, 'Chegadas e saídas'],
  [/^\/portal\/publico\/consulta-container\/?$/, 'Consulta de container'],
  [/^\/portal\/publico(?:\/|$)/, 'Página não encontrada'],
  [/^\/portal\/desbloqueio-ce/, 'Portal · Desbloqueio de CE'],
  [/^\/portal\/login/, 'Portal · Login'],
  [/^\/portal\/esqueci-senha/, 'Portal · Recuperar senha'],
  [/^\/portal\/recuperar-senha/, 'Portal · Nova senha'],
  [/^\/portal\/ativar/, 'Portal · Ativação'],
  [/^\/portal\/confirmar-email/, 'Portal · Confirmar email'],
  [/^\/portal\/billing/, 'Portal · Faturas'],
  [/^\/portal\/operacao/, 'Portal · Operação'],
  [/^\/portal\/informacoes/, 'Portal · Informações'],
  [/^\/portal\/perfil/, 'Portal · Perfil'],
  [/^\/portal$/, 'Portal · Painel'],
]

export function portalRouteTitle(pathname: string): string {
  const match = ROUTE_TITLES.find(([pattern]) => pattern.test(pathname))
  return match ? `${match[1]} · ${BASE}` : BASE
}
