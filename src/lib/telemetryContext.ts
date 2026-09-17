import { classifyDbError, extractErrorText } from './errors'

export type QueryContextInfo = {
  modulo: string
  tela: string
  tarefa: string
  resumo: string
}

export type MutationContextInfo = {
  modulo: string
  tela: string
  tarefa: string
  resumo: string
}

export type RouteContextInfo = {
  modulo: string
  tela: string
}

export type TelemetryErrorClassification = {
  categoria: string
  diagnostico: string
  codigo?: string
}

type QueryKeyMapEntry = {
  modulo: string
  tela: string
  tarefa: string
}

const QUERY_KEY_MAP: Record<string, QueryKeyMapEntry> = {
  // Financeiro e Conciliação
  'pix-reconciliation-exceptions': {
    modulo: 'Financeiro',
    tela: 'Conciliação PIX',
    tarefa: 'Listar pendências PIX',
  },
  'pix-reconciliation-candidates': {
    modulo: 'Financeiro',
    tela: 'Conciliação PIX',
    tarefa: 'Buscar candidatas para vinculação',
  },
  'reconciliation-history': {
    modulo: 'Financeiro',
    tela: 'Conciliação PIX',
    tarefa: 'Carregar histórico de pagamentos e baixas',
  },
  'customer-reconciliation-queue': {
    modulo: 'Financeiro',
    tela: 'Conciliação de Clientes',
    tarefa: 'Listar fila de conciliação de clientes',
  },
  'baplie-reconciliation': {
    modulo: 'Operações',
    tela: 'Conciliação Baplie',
    tarefa: 'Conciliar Baplie com Manifesto',
  },

  // Faturamento e Faturas
  invoices: {
    modulo: 'Faturamento',
    tela: 'Faturas Locais',
    tarefa: 'Listar faturas',
  },
  'invoice-detail': {
    modulo: 'Faturamento',
    tela: 'Detalhe da Fatura',
    tarefa: 'Carregar detalhes da fatura',
  },
  'invoice-links': {
    modulo: 'Faturamento',
    tela: 'Vínculos de Fatura',
    tarefa: 'Consultar vínculos da fatura',
  },
  'invoice-bl-subtotal': {
    modulo: 'Faturamento',
    tela: 'Faturas Locais',
    tarefa: 'Calcular subtotal de BL da fatura',
  },
  'billing-ready-bls': {
    modulo: 'Faturamento',
    tela: 'Prontos para Faturar',
    tarefa: 'Listar BLs prontos para emissão',
  },
  'billing-ready-bl-diagnostics': {
    modulo: 'Faturamento',
    tela: 'Diagnóstico de Faturamento',
    tarefa: 'Carregar diagnóstico de faturamento',
  },
  'billing-ready-granite-bls': {
    modulo: 'Faturamento',
    tela: 'Faturamento Granito',
    tarefa: 'Listar BLs de granito para faturamento',
  },
  'billing-customers': {
    modulo: 'Faturamento',
    tela: 'Faturamento',
    tarefa: 'Buscar clientes faturáveis',
  },
  'billing-ledger': {
    modulo: 'Faturamento',
    tela: 'Livro Razão',
    tarefa: 'Consultar títulos e recebíveis',
  },
  'billing-runs': {
    modulo: 'Faturamento',
    tela: 'Lotes de Faturamento',
    tarefa: 'Listar execuções de faturamento em lote',
  },
  'billing-run-detail': {
    modulo: 'Faturamento',
    tela: 'Lotes de Faturamento',
    tarefa: 'Carregar detalhes do lote de faturamento',
  },

  // Demurrage
  'demurrage-invoices': {
    modulo: 'Demurrage',
    tela: 'Faturas Demurrage',
    tarefa: 'Listar faturas de demurrage',
  },
  'demurrage-invoice-detail': {
    modulo: 'Demurrage',
    tela: 'Detalhe Demurrage',
    tarefa: 'Carregar detalhes da fatura de demurrage',
  },
  'demurrage-rates': {
    modulo: 'Demurrage',
    tela: 'Tarifas Demurrage',
    tarefa: 'Carregar tabela de tarifas de demurrage',
  },
  'customer-demurrage-agreements': {
    modulo: 'Demurrage',
    tela: 'Acordos Demurrage',
    tarefa: 'Carregar acordos de free time e diárias',
  },
  'demurrage-kpis': {
    modulo: 'Demurrage',
    tela: 'Painel Demurrage',
    tarefa: 'Carregar indicadores operacionais de demurrage',
  },

  // Tabelas de Cobrança Local
  'local-charge-tables': {
    modulo: 'Tabelas Comerciais',
    tela: 'Tabelas de Cobrança',
    tarefa: 'Carregar tabelas de cobrança local',
  },
  'local-charge-operations': {
    modulo: 'Tabelas Comerciais',
    tela: 'Operações de Cobrança',
    tarefa: 'Listar operações de cobrança',
  },
  'local-charge-overrides': {
    modulo: 'Tabelas Comerciais',
    tela: 'Exceções Comerciais',
    tarefa: 'Listar overrides e exceções de tabela',
  },
  'local-charge-pendencies': {
    modulo: 'Faturamento',
    tela: 'Pendências de Cobrança',
    tarefa: 'Listar pendências de cobrança local',
  },
  'local-charge-override-items': {
    modulo: 'Tabelas Comerciais',
    tela: 'Exceções Comerciais',
    tarefa: 'Carregar itens de exceção comercial',
  },
  'local-charge-override-customers': {
    modulo: 'Tabelas Comerciais',
    tela: 'Exceções Comerciais',
    tarefa: 'Buscar clientes com exceção comercial',
  },

  // BLs e Carga
  bls: {
    modulo: 'Operações',
    tela: 'Painel de BLs',
    tarefa: 'Listar conhecimentos de embarque (BLs)',
  },
  containers: {
    modulo: 'Operações',
    tela: 'Painel de Containers',
    tarefa: 'Listar containers',
  },
  'bl-detail': {
    modulo: 'Operações',
    tela: 'Cockpit do BL',
    tarefa: 'Carregar dados detalhados do BL',
  },
  'bl-cockpit': {
    modulo: 'Operações',
    tela: 'Cockpit do BL',
    tarefa: 'Carregar cockpit operacional do BL',
  },
  'bl-summary': {
    modulo: 'Operações',
    tela: 'Painel de BLs',
    tarefa: 'Carregar resumo operacional de BLs',
  },
  'bl-local-charge-lines': {
    modulo: 'Faturamento',
    tela: 'Cobranças do BL',
    tarefa: 'Carregar linhas de cobrança local do BL',
  },
  'manual-charge-items': {
    modulo: 'Faturamento',
    tela: 'Cobranças Manuais',
    tarefa: 'Carregar itens manuais do BL',
  },
  'bl-timeline': {
    modulo: 'Operações',
    tela: 'Histórico do BL',
    tarefa: 'Carregar linha do tempo do BL',
  },

  // Viagens e Escalas
  voyages: {
    modulo: 'Viagens',
    tela: 'Escalas e Viagens',
    tarefa: 'Listar viagens',
  },
  'voyage-options': {
    modulo: 'Viagens',
    tela: 'Viagens',
    tarefa: 'Carregar opções de seleção de viagem',
  },
  'voyage-detail': {
    modulo: 'Viagens',
    tela: 'Detalhe da Viagem',
    tarefa: 'Carregar detalhes da viagem',
  },
  'voyage-billing-status': {
    modulo: 'Viagens',
    tela: 'Status de Faturamento da Viagem',
    tarefa: 'Consultar status de faturamento da viagem',
  },
  'voyage-pol-schedules': {
    modulo: 'Viagens',
    tela: 'Escalas (Origem)',
    tarefa: 'Carregar escalas de embarque (POL)',
  },
  'voyage-pod-schedules': {
    modulo: 'Viagens',
    tela: 'Escalas (Destino)',
    tarefa: 'Carregar escalas de desembarque (POD)',
  },
  'voyage-escala-schedules': {
    modulo: 'Viagens',
    tela: 'Programação de Escalas',
    tarefa: 'Carregar programação de escalas da viagem',
  },
  'voyage-route-ce-masters': {
    modulo: 'Viagens',
    tela: 'CE Mercante',
    tarefa: 'Consultar CE Masters da rota da viagem',
  },
  'voyage-export-schedules': {
    modulo: 'Viagens',
    tela: 'Exportação',
    tarefa: 'Carregar cronograma de exportação',
  },
  'voyage-vazios-export-ports': {
    modulo: 'Viagens',
    tela: 'Controle de Vazios',
    tarefa: 'Consultar portos de exportação de vazios',
  },
  'voyage-escala-terminal': {
    modulo: 'Viagens',
    tela: 'Terminais',
    tarefa: 'Carregar estado terminal das escalas',
  },
  'voyage-timeline': {
    modulo: 'Viagens',
    tela: 'Linha do Tempo',
    tarefa: 'Carregar linha do tempo da viagem',
  },

  // Agência e Relatórios
  'agency-report': {
    modulo: 'Agência',
    tela: 'Relatório de Agência',
    tarefa: 'Carregar relatório de agência marítima',
  },
  'agency-report-own': {
    modulo: 'Agência',
    tela: 'Relatório Próprio de Agência',
    tarefa: 'Carregar relatório operacional próprio',
  },

  // Clientes
  customers: {
    modulo: 'Clientes',
    tela: 'Cadastro de Clientes',
    tarefa: 'Listar clientes',
  },
  'customer-detail': {
    modulo: 'Clientes',
    tela: 'Ficha do Cliente',
    tarefa: 'Carregar dados cadastrais do cliente',
  },
  'customers-summary': {
    modulo: 'Clientes',
    tela: 'Resumo de Clientes',
    tarefa: 'Carregar indicadores de clientes',
  },
  'customer-ficha': {
    modulo: 'Clientes',
    tela: 'Ficha Financeira do Cliente',
    tarefa: 'Carregar extrato e pendências do cliente',
  },
  'customer-communications': {
    modulo: 'Comunicações',
    tela: 'Comunicações com Clientes',
    tarefa: 'Carregar histórico de avisos e comunicados',
  },

  // Alertas e Notificações
  alerts: {
    modulo: 'Alertas',
    tela: 'Fila de Alertas',
    tarefa: 'Listar alertas operacionais',
  },
  'alert-department-summary': {
    modulo: 'Alertas',
    tela: 'Fila de Alertas',
    tarefa: 'Carregar resumo de alertas por departamento',
  },
  'financial-alerts': {
    modulo: 'Alertas',
    tela: 'Alertas Financeiros',
    tarefa: 'Listar alertas financeiros pendentes',
  },
  'internal-notifications': {
    modulo: 'Notificações',
    tela: 'Notificações Internas',
    tarefa: 'Carregar notificações do sino',
  },
  'internal-notifications-unread-count': {
    modulo: 'Notificações',
    tela: 'Sino de Notificações',
    tarefa: 'Contar notificações não lidas',
  },

  // Portal do Cliente
  'portal-invoices': {
    modulo: 'Portal do Cliente',
    tela: 'Faturas do Cliente',
    tarefa: 'Carregar faturas disponíveis no portal',
  },
  'portal-current-roe': {
    modulo: 'Portal do Cliente',
    tela: 'Câmbio PTAX',
    tarefa: 'Consultar taxa cambial do dia',
  },
  'bl-portal-status': {
    modulo: 'Portal do Cliente',
    tela: 'Consulta de BL',
    tarefa: 'Consultar status do BL no portal',
  },

  // Painel Geral e Configurações
  dashboard: {
    modulo: 'Painel',
    tela: 'Painel Principal',
    tarefa: 'Carregar métricas e indicadores do painel',
  },
  'app-settings': {
    modulo: 'Configurações',
    tela: 'Configurações Gerais',
    tarefa: 'Carregar parâmetros da aplicação',
  },
  transshipments: {
    modulo: 'Operações',
    tela: 'Transbordos',
    tarefa: 'Listar transbordos da escala',
  },
  vehicles: {
    modulo: 'Operações',
    tela: 'Veículos',
    tarefa: 'Carregar dados de veículos',
  },
  'voyage-vehicle-stats': {
    modulo: 'Operações',
    tela: 'Estatísticas de Veículos',
    tarefa: 'Carregar estatísticas de carga rolante',
  },
}

function humanizeIdentifier(token: string): string {
  return token
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

/**
 * Converte qualquer queryKey do TanStack Query em contexto de negócio didático.
 */
export function describeQuery(queryKey: unknown): QueryContextInfo {
  if (!Array.isArray(queryKey) || queryKey.length === 0) {
    return {
      modulo: 'Geral',
      tela: 'Sistema',
      tarefa: 'Consulta de dados',
      resumo: 'Falha ao executar consulta de dados no sistema.',
    }
  }

  const primaryKey = String(queryKey[0])
  const mapped = QUERY_KEY_MAP[primaryKey]

  if (mapped) {
    return {
      ...mapped,
      resumo: `Falha ao executar "${mapped.tarefa}" na tela "${mapped.tela}" (${mapped.modulo}).`,
    }
  }

  // Fallback inteligente para chaves dinâmicas
  const readable = humanizeIdentifier(primaryKey)
  return {
    modulo: readable,
    tela: readable,
    tarefa: `Consultar ${readable.toLowerCase()}`,
    resumo: `Falha ao consultar ${readable.toLowerCase()} no sistema.`,
  }
}

/**
 * Converte mutationKey em contexto de negócio didático.
 */
export function describeMutation(mutationKey?: unknown, meta?: Record<string, unknown>): MutationContextInfo {
  if (Array.isArray(mutationKey) && mutationKey.length > 0) {
    const primaryKey = String(mutationKey[0])
    const mapped = QUERY_KEY_MAP[primaryKey]
    if (mapped) {
      return {
        modulo: mapped.modulo,
        tela: mapped.tela,
        tarefa: `Salvar/Alterar: ${mapped.tarefa}`,
        resumo: `Falha ao executar ação de salvamento em "${mapped.tela}" (${mapped.modulo}).`,
      }
    }
    const readable = humanizeIdentifier(primaryKey)
    return {
      modulo: readable,
      tela: readable,
      tarefa: `Operação em ${readable}`,
      resumo: `Falha ao executar alteração em ${readable}.`,
    }
  }

  const actionHint = typeof meta?.action === 'string' ? meta.action : 'Operação de dados'
  return {
    modulo: 'Operações',
    tela: 'Geral',
    tarefa: actionHint,
    resumo: `Falha ao processar ação: ${actionHint}.`,
  }
}

const ROUTE_MAP: Array<{ prefix: string; modulo: string; tela: string }> = [
  { prefix: '/reconciliacao', modulo: 'Financeiro', tela: 'Conciliação PIX' },
  { prefix: '/invoices', modulo: 'Faturamento', tela: 'Faturas Locais' },
  { prefix: '/demurrage', modulo: 'Demurrage', tela: 'Faturas e Acordos Demurrage' },
  { prefix: '/faturamento', modulo: 'Faturamento', tela: 'Faturamento' },
  { prefix: '/bls', modulo: 'Operações', tela: 'Painel de BLs' },
  { prefix: '/viagens', modulo: 'Viagens', tela: 'Escalas e Viagens' },
  { prefix: '/clientes/portal', modulo: 'Portal do Cliente', tela: 'Portal de Autoatendimento' },
  { prefix: '/clientes', modulo: 'Clientes', tela: 'Gestão de Clientes' },
  { prefix: '/alertas', modulo: 'Alertas', tela: 'Fila de Alertas Operacionais' },
  { prefix: '/relatorio-agencia', modulo: 'Agência', tela: 'Relatório de Agência' },
  { prefix: '/tabelas', modulo: 'Tabelas Comerciais', tela: 'Tabelas de Preço e Cobrança' },
  { prefix: '/painel', modulo: 'Painel', tela: 'Painel Principal' },
  { prefix: '/configuracoes', modulo: 'Configurações', tela: 'Configurações do Sistema' },
]

/**
 * Traduz a URL atual para a tela e módulo correspondentes.
 */
export function describeRoute(pathname: string): RouteContextInfo {
  const normalized = pathname.toLowerCase()
  const matched = ROUTE_MAP.find((item) => normalized.startsWith(item.prefix))
  if (matched) {
    return { modulo: matched.modulo, tela: matched.tela }
  }

  if (normalized === '/' || normalized === '') {
    return { modulo: 'Painel', tela: 'Início' }
  }

  const segment = normalized.split('/')[1] || 'sistema'
  return {
    modulo: humanizeIdentifier(segment),
    tela: humanizeIdentifier(segment),
  }
}

/**
 * Classifica a natureza técnica do erro em categorias compreensíveis.
 */
export function classifyErrorForTelemetry(error: unknown): TelemetryErrorClassification {
  const errorText = extractErrorText(error)
  const isNetwork =
    error instanceof TypeError &&
    (/failed to fetch/i.test(error.message) || /networkerror/i.test(error.message) || /load failed/i.test(error.message))

  if (isNetwork || /network request failed/i.test(errorText)) {
    return {
      categoria: 'Conectividade / Rede',
      diagnostico: 'Falha de conexão com os servidores. O navegador não conseguiu completar a requisição.',
    }
  }

  const isAbort = error instanceof DOMException && error.name === 'AbortError'
  if (isAbort || /aborted/i.test(errorText)) {
    return {
      categoria: 'Conectividade / Timeout',
      diagnostico: 'A requisição foi interrompida ou demorou mais do que o limite aceitável.',
    }
  }

  const dbClassification = classifyDbError(error)
  if (dbClassification.kind !== 'desconhecido') {
    const categoriaMap: Record<string, string> = {
      permissao: 'Segurança / Permissão',
      sessao_expirada: 'Autenticação / Sessão Expirada',
      conflito: 'Banco de Dados / Conflito de Dados',
      limite: 'Desempenho / Limite Excedido',
      validacao: 'Regra de Negócio / Validação',
      nao_encontrado: 'Banco de Dados / Registro Inexistente',
    }

    const code = error && typeof error === 'object' ? String((error as { code?: unknown }).code ?? '') : undefined

    return {
      categoria: categoriaMap[dbClassification.kind] || 'Banco de Dados / Regra de Negócio',
      diagnostico: dbClassification.message,
      codigo: code || undefined,
    }
  }

  // Falhas de JavaScript runtime (TypeError, ReferenceError)
  if (error instanceof TypeError) {
    return {
      categoria: 'Erro de Código / Runtime',
      diagnostico: `Exceção de tipo no navegador: ${error.message}`,
    }
  }

  if (error instanceof ReferenceError || error instanceof RangeError) {
    return {
      categoria: 'Erro de Código / Runtime',
      diagnostico: `Exceção de execução no navegador: ${error.message}`,
    }
  }

  return {
    categoria: 'Erro Não Tratado',
    diagnostico: errorText || 'Ocorreu um erro inesperado durante o processamento.',
  }
}
