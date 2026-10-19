// "O que cada setor pode" (lote 5b, tela Administração, decisão de
// 2026-10-19: opção A com C). Fonte única da matriz da aba Usuários e da
// lista "Com este setor, ... pode" das janelas de usuário. As 39 linhas
// resumem as ações de docs/operations/seguranca.md § "Modelo de permissões
// por perfil", que diz onde o banco aplica cada uma.
//
// Cada linha cita, em `proof`, os casos de
// src/integration/permissoesPorPerfil.local-pg.test.ts que executam a ação
// como cada setor no Postgres:
// - `exceção: <linha>`: linha da tabela MATRIX_EXCEPTIONS, cujos setores
//   permitidos têm de ser exatamente os ✓ desta linha;
// - `todos: <linha>`: linha da tabela MATRIX_GLOBAL, que os cinco setores
//   executam (a linha do catálogo tem de ser ✓ para todos);
// - `caso: <início do título>`: um teste próprio da bateria.
// permissionMatrix.test.ts falha se uma linha ficar sem caso ou citar caso
// que não existe; a bateria falha se o banco mudar e o catálogo não.

export type Department = 'administrativo' | 'financeiro' | 'operacoes' | 'documentacao' | 'equipamentos'

export const DEPARTMENTS: readonly Department[] = ['administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos']

/** `true` pode (✓), `false` não pode (○), texto quando pode com condição. */
export type PermissionCell = boolean | string

export type PermissionGroup = {
  id: string
  label: string
}

export type PermissionRow = {
  id: string
  group: string
  action: string
  can: Readonly<Record<Department, PermissionCell>>
  proof: readonly string[]
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  { id: 'usuarios', label: 'Usuários e sistema' },
  { id: 'viagens', label: 'Viagens, B/L e ADR de Saída' },
  { id: 'importacoes', label: 'Importações e cadastros' },
  { id: 'taxas', label: 'Taxas Locais e faturamento' },
  { id: 'demurrage', label: 'Demurrage' },
  { id: 'pix', label: 'Conciliação Pix' },
  { id: 'clientes', label: 'Clientes, Comunicação e Portal' },
  { id: 'ce', label: 'Desbloqueio de CE' },
  { id: 'alertas', label: 'Alertas' },
]

/**
 * Tipos de alerta que cada setor recebe pela audiência do catálogo de alertas
 * (`alert_type_catalog.audience_departments`, tipos ativos). A bateria confere
 * estes números no banco.
 */
export const ALERT_TYPE_COUNTS: Readonly<Record<Department, number>> = {
  administrativo: 15,
  financeiro: 3,
  operacoes: 3,
  documentacao: 36,
  equipamentos: 2,
}

function only(...allowed: Department[]): Record<Department, PermissionCell> {
  return Object.fromEntries(DEPARTMENTS.map((department) => [department, allowed.includes(department)])) as Record<Department, PermissionCell>
}

const ALL = only(...DEPARTMENTS)
const ADM = only('administrativo')
const ADM_FIN = only('administrativo', 'financeiro')
const ADM_DOC = only('administrativo', 'documentacao')
const ADM_DOC_EQU = only('administrativo', 'documentacao', 'equipamentos')

function alertTypes(count: number) {
  return `${count} ${count === 1 ? 'tipo' : 'tipos'}`
}

export const PERMISSION_MATRIX: readonly PermissionRow[] = [
  // Usuários e sistema
  { id: 'abrir-administracao', group: 'usuarios', action: 'Abrir a Administração (usuários, histórico, sistema)', can: ADM, proof: ['exceção: Abrir a Administração'] },
  { id: 'gerir-usuarios', group: 'usuarios', action: 'Criar usuário, mudar setor, ativar e desativar, trocar e-mail e senha', can: ADM, proof: ['caso: Catálogo: só o Administrativo muda o setor e a situação de um usuário'] },
  { id: 'envio-real-emails', group: 'usuarios', action: 'Ligar e desligar o envio real de e-mails', can: ADM, proof: ['exceção: Ligar e desligar o envio real de e-mails'] },
  { id: 'ultimo-administrativo', group: 'usuarios', action: 'Desativar ou rebaixar o último Administrativo ativo', can: only(), proof: ['caso: Catálogo: ninguém desativa nem rebaixa o último Administrativo ativo'] },

  // Viagens, B/L e ADR de Saída
  { id: 'editar-viagem', group: 'viagens', action: 'Criar e editar viagem, escala e programação; omitir escala; fechar o ADR', can: ALL, proof: ['todos: Editar viagem', 'todos: Editar escala de exportação', 'todos: Fechar o ADR de Saída'] },
  { id: 'reverter-omissao-reabrir-adr', group: 'viagens', action: 'Reverter omissão de escala e reabrir ADR fechado, com motivo', can: ALL, proof: ['caso: P6:'] },
  { id: 'cancelar-reativar-viagem-bl', group: 'viagens', action: 'Cancelar e reativar Viagem e B/L, com motivo', can: ADM, proof: ['exceção: Cancelar viagem', 'exceção: Reativar viagem', 'exceção: Cancelar B/L', 'exceção: Reativar B/L'] },
  { id: 'excluir-registros', group: 'viagens', action: 'Excluir viagem, escala, atracação, B/L, container e Cliente', can: ADM, proof: ['exceção: Excluir viagem com Trava', 'exceção: Excluir escala', 'exceção: Excluir Cliente', 'caso: A7: delete_escala segue excluindo'] },
  {
    id: 'assinar-adr', group: 'viagens', action: 'Assinar e observar a seção do ADR de Saída',
    can: { administrativo: 'Cobre quem faltar', financeiro: false, operacoes: 'Só a própria seção', documentacao: 'Só a própria seção', equipamentos: 'Só a própria seção' },
    proof: ['caso: Catálogo: assinatura e observação do ADR de Saída'],
  },

  // Importações e cadastros
  { id: 'importar', group: 'importacoes', action: 'Importar arquivos (B/L, CE, Baplie, veículos, Vazios, Granito, datas, Clientes)', can: ALL, proof: ['caso: P13: %s importa Baplie vazio'] },
  { id: 'reprocessar-importacao', group: 'importacoes', action: 'Reprocessar efeito de importação, com justificativa', can: ALL, proof: ['caso: P7:'] },
  { id: 'veiculos-vazios', group: 'importacoes', action: 'Excluir ou mover veículo; excluir unidade e linha de Vazios antes do ADR fechado', can: ALL, proof: ['todos: Excluir veículo', 'todos: Mover veículo', 'todos: Excluir unidade de Vazios'] },
  { id: 'remover-ce', group: 'importacoes', action: 'Remover o CE Mercante do B/L sem fatura, com motivo', can: ALL, proof: ['todos: Remover o CE Mercante do B/L'] },
  { id: 'editar-cadastros', group: 'importacoes', action: 'Criar e editar navio, armador, porto, Local e serviço', can: ALL, proof: ['todos: Editar navio', 'todos: Editar armador', 'caso: B15:'] },
  { id: 'desativar-cadastros', group: 'importacoes', action: 'Desativar, reativar e excluir cadastro (Local, serviço) sem uso', can: ADM, proof: ['caso: B15:', 'exceção: Excluir cadastro sem uso'] },
  { id: 'central-informacoes', group: 'importacoes', action: 'Publicar na Central de Informações do Portal', can: ALL, proof: ['caso: P8:'] },

  // Taxas Locais e faturamento
  { id: 'editar-taxas', group: 'taxas', action: 'Criar e editar tabela, item e Condição de Cliente; lançar e editar taxa manual', can: ALL, proof: ['todos: Editar tabela de Taxas Locais', 'todos: Editar item de Taxas Locais', 'todos: Lançar taxa manual'] },
  { id: 'excluir-taxa-manual', group: 'taxas', action: 'Excluir taxa manual do B/L', can: ADM, proof: ['exceção: Excluir taxa manual do B/L'] },
  { id: 'desativar-tarifa', group: 'taxas', action: 'Desativar, reativar e excluir tarifa', can: ADM, proof: ['caso: P9:', 'caso: B13:'] },
  { id: 'emitir-fatura', group: 'taxas', action: 'Emitir fatura (do B/L, na Validação, consolidada, avulsa) e corrigir fatura emitida', can: ALL, proof: ['caso: A9:', 'caso: P4:'] },
  { id: 'autorizar-restituicao', group: 'taxas', action: 'Autorizar restituição excepcional e cancelar a autorização', can: ALL, proof: ['caso: P5: %s lê a Conciliação, autoriza restituição'] },
  { id: 'baixa-restituicao', group: 'taxas', action: 'Registrar pagamento (baixa manual) e confirmar Restituição', can: ADM_FIN, proof: ['caso: P5: baixa manual e conciliar PIX', 'exceção: Registrar a Restituição (fatura)', 'exceção: Registrar a Restituição (Demurrage)'] },
  { id: 'ajuste-cod', group: 'taxas', action: 'Liquidar Ajuste de COD', can: ADM_FIN, proof: ['exceção: Liquidar Ajuste de COD'] },
  { id: 'cancelar-fatura', group: 'taxas', action: 'Cancelar fatura, cancelar baixa e preparar cancelamento financeiro de B/L', can: ADM, proof: ['exceção: Cancelar fatura', 'exceção: Cancelar fatura consolidada', 'exceção: Cancelar baixa', 'exceção: Preparar cancelamento financeiro de B/L'] },

  // Demurrage
  { id: 'gerar-invoice', group: 'demurrage', action: 'Gerar Invoice e complementar; aplicar desconto; editar tarifa, acordo e condição de Demurrage do B/L', can: ALL, proof: ['caso: P4:', 'caso: P5: %s lê a Conciliação, autoriza restituição e aplica desconto', 'caso: P9:', 'todos: Condição de Demurrage do B/L'] },
  { id: 'disputas', group: 'demurrage', action: 'Ver Disputas e editar os dados da disputa e o vencimento', can: ALL, proof: ['caso: P12: %s lê o Desbloqueio de CE com os documentos, as Disputas', 'todos: Editar os dados da disputa'] },
  { id: 'baixa-invoice', group: 'demurrage', action: 'Registrar pagamento de Invoice', can: ADM_FIN, proof: ['exceção: Baixa de Invoice de Demurrage'] },
  { id: 'informar-ptax', group: 'demurrage', action: 'Informar PTAX', can: only('administrativo', 'financeiro', 'equipamentos'), proof: ['exceção: Informar PTAX'] },
  { id: 'responder-disputa', group: 'demurrage', action: 'Responder, reabrir e anexar na Disputa', can: only('administrativo', 'equipamentos'), proof: ['exceção: Responder Disputa', 'exceção: Reabrir Disputa'] },
  { id: 'cancelar-invoice', group: 'demurrage', action: 'Cancelar Invoice e cancelar baixa; mudar o intervalo da Régua', can: ADM, proof: ['exceção: Cancelar Invoice de Demurrage', 'exceção: Cancelar baixa de Demurrage', 'exceção: Intervalo da Régua'] },

  // Conciliação Pix
  { id: 'ver-conciliacao', group: 'pix', action: 'Ver a fila, as exceções e o monitor Itaú', can: ALL, proof: ['caso: P5: %s lê a Conciliação'] },
  { id: 'conciliar', group: 'pix', action: 'Conciliar: vincular, confirmar, tratar exceção, marcar recebimento Itaú', can: ADM_FIN, proof: ['caso: P5: baixa manual e conciliar PIX'] },

  // Clientes, Comunicação e Portal
  { id: 'editar-cliente', group: 'clientes', action: 'Criar e editar Cliente; ler o Histórico de Comunicados e o console do Portal', can: ALL, proof: ['todos: Editar Cliente', 'todos: Ler o Histórico de Comunicados', 'caso: A18:'] },
  { id: 'contatos-comunicados', group: 'clientes', action: 'Editar contatos e Caixas de Comunicação; disparar Comunicado', can: ADM_DOC_EQU, proof: ['exceção: Editar contatos do Cliente', 'exceção: Salvar modelo de Comunicado', 'caso: P3: a tela edita contatos pela RPC'] },
  { id: 'provisionar-portal', group: 'clientes', action: 'Provisionar o Portal: convite (enviar e cancelar), conta, e-mail de recuperação, reabrir análise', can: ADM_DOC, proof: ['exceção: Cancelar convite do Portal', 'exceção: Trocar o e-mail de recuperação do Portal', 'exceção: Liberar e-mail bloqueado do Portal', 'exceção: Reabrir análise do Portal'] },
  { id: 'desativar-cliente', group: 'clientes', action: 'Desativar e reativar Cliente; trocar o CNPJ do Portal; Liberação de faturamento', can: ADM, proof: ['exceção: Desativar Cliente', 'exceção: Reativar Cliente', 'exceção: Trocar o CNPJ do Portal', 'exceção: Conceder Liberação de faturamento', 'exceção: Revogar Liberação de faturamento'] },

  // Desbloqueio de CE
  { id: 'ver-desbloqueio', group: 'ce', action: 'Ver pedidos e abrir documentos', can: ALL, proof: ['caso: P12: %s lê o Desbloqueio de CE'] },
  { id: 'gerir-desbloqueio', group: 'ce', action: 'Gerir pedidos, documentos, exportação para a ZPT e conciliação', can: ADM_DOC, proof: ['exceção: Gerir o Desbloqueio de CE', 'caso: P12: gerir o Desbloqueio de CE e responder Disputas seguem restritos'] },

  // Alertas
  {
    id: 'alertas-do-setor', group: 'alertas', action: 'Recebe os alertas do próprio setor',
    can: {
      administrativo: `${alertTypes(ALERT_TYPE_COUNTS.administrativo)}; também os críticos de setor sem ninguém ativo`,
      financeiro: `${alertTypes(ALERT_TYPE_COUNTS.financeiro)} (Pix, Restituição, Fatura desatualizada)`,
      operacoes: alertTypes(ALERT_TYPE_COUNTS.operacoes),
      documentacao: alertTypes(ALERT_TYPE_COUNTS.documentacao),
      equipamentos: alertTypes(ALERT_TYPE_COUNTS.equipamentos),
    },
    proof: ['caso: Catálogo: cada setor recebe os tipos de alerta que a tela diz', 'caso: P5: Pix não conciliado, Fatura desatualizada e Restituição pendente avisam o Financeiro'],
  },
]

/** O setor pode a ação (✓ ou com condição). */
export function departmentCan(row: PermissionRow, department: Department): boolean {
  return row.can[department] !== false
}

/** Setores que podem a ação (✓ ou com condição), na ordem das colunas. */
export function allowedDepartments(row: PermissionRow): Department[] {
  return DEPARTMENTS.filter((department) => departmentCan(row, department))
}

/** Linha em que os cinco setores podem igual: some com "Só exclusivas". */
export function isSharedByAll(row: PermissionRow): boolean {
  return DEPARTMENTS.every((department) => row.can[department] === true)
}

export function rowsByGroup(rows: readonly PermissionRow[] = PERMISSION_MATRIX) {
  return PERMISSION_GROUPS
    .map((group) => ({ group, rows: rows.filter((row) => row.group === group.id) }))
    .filter((entry) => entry.rows.length > 0)
}

export type DepartmentCapabilities = {
  /** O que todos os setores podem, num resumo só. */
  shared: string
  /** Ações exclusivas que o setor pode, com a condição quando houver. */
  can: string[]
  /** Ações exclusivas que o setor não pode. */
  cannot: string[]
}

/**
 * Lista "Com este setor, ... pode" (opção C), derivada da matriz: o resumo do
 * que é de todos e, linha a linha, as ações exclusivas que o setor pode e não
 * pode. Muda na hora quando o setor escolhido muda.
 */
export function capabilitiesFor(department: Department): DepartmentCapabilities {
  const exclusive = PERMISSION_MATRIX.filter((row) => !isSharedByAll(row))
  return {
    shared: 'Ler tudo; criar e editar viagens, B/Ls, Clientes, taxas e faturas, como os cinco setores',
    can: exclusive
      .filter((row) => departmentCan(row, department))
      .map((row) => (typeof row.can[department] === 'string' ? `${row.action}: ${lowerFirst(row.can[department] as string)}` : row.action)),
    cannot: exclusive.filter((row) => !departmentCan(row, department)).map((row) => row.action),
  }
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1)
}
