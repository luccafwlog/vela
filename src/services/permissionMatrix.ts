// "O que cada setor pode" (lote 5b, tela Administração, decisão de
// 2026-10-19: opção A com C). Fonte única da matriz da aba Usuários e da
// lista "Com este setor, ... pode" das janelas de usuário. As 49 linhas
// resumem as ações de docs/operations/seguranca.md § "Modelo de permissões
// por perfil", que diz onde o banco aplica cada uma.
//
// A conta Dev (ADR 0104: Administrativo com a marca Dev) pode tudo o que
// qualquer setor pode (decisão do dono de 2026-11-04). Nas linhas que saem do
// Administrativo, a coluna dele diz `DEV_ONLY`: só a conta Dev.
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
 * Tipos de alerta que chegam ao sino de cada setor (migration 476, ADR 0107):
 * os tipos de que ele é o setor responsável (`alert_type_catalog.audience_departments`,
 * tipos ativos) e, em Operações e Equipamentos, os dois do ADR de Saída da
 * própria seção (ALE-D13); a Documentação, a Demurrage travada pelos motivos dela
 * (CE, Cliente, Portal; migration 516). Equipamentos recebe também o prazo da Disputa
 * de Demurrage (migration 520). O Financeiro recebe os quatro da exceção do dono e a Taxa alterada à mão mudou (migration 495).
 * O Administrativo recebe também o Retorno do provedor de e-mail não aplicado (migration 535).
 * Operações recebe também a Escala sem terminal (migration 584). Desde a migration 587,
 * Pix não conciliado e Restituição pendente são do setor (a Consulta Itaú parada, técnica, é da conta Dev desde a 620)
 * Financeiro e saem do Administrativo.
 * A bateria confere estes números no banco.
 */
export const ALERT_TYPE_COUNTS: Readonly<Record<Department, number>> = {
  administrativo: 25,
  financeiro: 4,
  operacoes: 5,
  documentacao: 38,
  equipamentos: 10,
}

/**
 * Célula do Administrativo quando, no setor, só a conta Dev pode a ação
 * (`is_dev_user()`, migration 469; `is_financeiro_or_dev_user()`, migration 583).
 */
export const DEV_ONLY = 'Só a conta Dev'

function only(...allowed: Department[]): Record<Department, PermissionCell> {
  return Object.fromEntries(DEPARTMENTS.map((department) => [department, allowed.includes(department)])) as Record<Department, PermissionCell>
}

const ALL = only(...DEPARTMENTS)
const ADM = only('administrativo')
const ADM_FIN = only('administrativo', 'financeiro')
const ADM_FIN_EQU = only('administrativo', 'financeiro', 'equipamentos')
const ADM_DOC = only('administrativo', 'documentacao')
const ADM_DOC_EQU = only('administrativo', 'documentacao', 'equipamentos')
// Decisão do dono de 2026-11-04 (migration 583): baixa, cancelamento de baixa,
// Restituição e Conciliação Pix são do Financeiro; no Administrativo, só a conta Dev.
const FIN_DEV: Record<Department, PermissionCell> = { ...only('financeiro'), administrativo: DEV_ONLY }

function alertTypes(count: number) {
  return `${count} ${count === 1 ? 'tipo' : 'tipos'}`
}

export const PERMISSION_MATRIX: readonly PermissionRow[] = [
  // Usuários e sistema
  { id: 'abrir-administracao', group: 'usuarios', action: 'Abrir a tela Administração e listar os usuários', can: ADM, proof: ['exceção: Abrir a Administração'] },
  { id: 'gerir-usuarios', group: 'usuarios', action: 'Criar usuário, mudar setor, ativar e desativar, trocar e-mail e senha', can: ADM, proof: ['caso: Catálogo: só o Administrativo muda o setor e a situação de um usuário'] },
  // Marca Dev (ADR 0104): só a conta do Administrativo com a marca, dada por migration.
  { id: 'envio-real-emails', group: 'usuarios', action: 'Ligar e desligar o envio real de e-mails', can: { ...only(), administrativo: DEV_ONLY }, proof: ['caso: Dev: só a conta Dev liga e desliga o envio real de e-mails'] },
  { id: 'ultimo-administrativo', group: 'usuarios', action: 'Desativar ou rebaixar o último Administrativo ativo', can: only(), proof: ['caso: Catálogo: ninguém desativa nem rebaixa o último Administrativo ativo'] },

  // Viagens, B/L e ADR de Saída
  { id: 'editar-viagem', group: 'viagens', action: 'Criar e editar viagem, escala e programação; omitir escala; fechar o ADR', can: ALL, proof: ['todos: Editar viagem', 'todos: Editar escala de exportação', 'todos: Fechar o ADR de Saída'] },
  { id: 'reverter-omissao-reabrir-adr', group: 'viagens', action: 'Reverter omissão de escala e reabrir ADR fechado, com motivo', can: ALL, proof: ['caso: P6:'] },
  { id: 'cancelar-reativar-viagem-bl', group: 'viagens', action: 'Cancelar e reativar Viagem e B/L, com motivo', can: ADM, proof: ['exceção: Cancelar viagem', 'exceção: Reativar viagem', 'exceção: Cancelar B/L', 'exceção: Reativar B/L'] },
  // Migration 544: o Embarque de vazios sem unidade, sem linha de serviço e com o ADR aberto.
  { id: 'excluir-registros', group: 'viagens', action: 'Excluir viagem, escala, B/L, container, Embarque de vazios e Cliente', can: ADM, proof: ['exceção: Excluir viagem com Trava', 'exceção: Excluir escala', 'exceção: Excluir Cliente', 'exceção: Excluir Embarque de vazios', 'caso: A7: delete_escala segue excluindo'] },
  // 02-viagens-adr:2 (migration 477): trocar o terminal de uma frente remove a atracação antiga.
  { id: 'remover-atracacao', group: 'viagens', action: 'Remover atracação (trocar o terminal de uma frente)', can: only('administrativo', 'operacoes'), proof: ['caso: 477: Operações e o Administrativo removem atracação'] },
  {
    id: 'assinar-adr', group: 'viagens', action: 'Assinar e observar a seção do ADR de Saída',
    can: { administrativo: 'Cobre quem faltar', financeiro: false, operacoes: 'Só a própria seção', documentacao: 'Só a própria seção', equipamentos: 'Só a própria seção' },
    proof: ['caso: Catálogo: assinatura e observação do ADR de Saída'],
  },

  // Importações e cadastros
  { id: 'importar', group: 'importacoes', action: 'Importar arquivos (B/L, CE, Baplie, veículos, Vazios, Granito, datas, Clientes)', can: ALL, proof: ['caso: P13: %s importa Baplie vazio'] },
  { id: 'reprocessar-importacao', group: 'importacoes', action: 'Reprocessar efeito de importação, com justificativa', can: ALL, proof: ['caso: P7:'] },
  // ADR 0128, item 9 (migration 598): Equipamentos responde; a Documentação só sente a trava do CE.
  // Marca Dev (ADR 0104): o EDI Mercante é só da conta Dev (decisão do dono de 2026-11-03); gravar o arquivo baixado é regra do banco desde a 600.
  { id: 'gerar-edi-mercante', group: 'importacoes', action: 'Gerar e baixar o EDI Mercante da rota (registrado no Histórico da Viagem)', can: { ...only(), administrativo: DEV_ONLY }, proof: ['caso: Dev: só a conta Dev registra o EDI Mercante baixado'] },
  { id: 'responder-veiculos', group: 'importacoes', action: 'Responder se a viagem terá veículos, trocar e desfazer a resposta', can: only('administrativo', 'equipamentos'), proof: ['exceção: Responder se a viagem terá veículos', 'exceção: Desfazer a resposta de veículos'] },
  { id: 'veiculos-vazios', group: 'importacoes', action: 'Excluir ou mover veículo; excluir unidade e linha de Vazios antes do ADR fechado', can: ALL, proof: ['todos: Excluir veículo', 'todos: Mover veículo', 'todos: Excluir unidade de Vazios'] },
  { id: 'remover-ce', group: 'importacoes', action: 'Remover o CE Mercante do B/L sem fatura, com motivo', can: ALL, proof: ['todos: Remover o CE Mercante do B/L'] },
  { id: 'editar-cadastros', group: 'importacoes', action: 'Criar e editar navio, armador, porto, Local e serviço', can: ALL, proof: ['todos: Editar navio', 'todos: Editar armador', 'caso: B15:'] },
  { id: 'desativar-cadastros', group: 'importacoes', action: 'Desativar, reativar e excluir cadastro (Local, serviço) sem uso', can: ADM, proof: ['caso: B15:', 'exceção: Excluir cadastro sem uso'] },
  { id: 'central-informacoes', group: 'importacoes', action: 'Publicar na Central de Informações do Portal', can: ALL, proof: ['caso: P8:'] },

  // Taxas Locais e faturamento
  { id: 'editar-taxas', group: 'taxas', action: 'Criar e editar tabela; incluir e corrigir item de tabela ainda sem uso; criar Condição de Cliente; lançar e editar taxa manual', can: ALL, proof: ['todos: Editar tabela de Taxas Locais', 'caso: Catálogo: item de tabela ainda sem uso', 'todos: Lançar taxa manual'] },
  // ADR 0111 (migration 491): qualquer setor altera, exclui e desfaz taxa do B/L, com justificativa.
  { id: 'excluir-taxa-manual', group: 'taxas', action: 'Alterar o valor e excluir taxa do B/L (calculada ou manual), com justificativa', can: ALL, proof: ['caso: P2: a taxa manual entra e sai pela RPC'] },
  // ADR 0111, D12 (migration 492): qualquer setor isenta o B/L das Taxas Locais, com justificativa.
  { id: 'isentar-taxas-locais', group: 'taxas', action: 'Isentar Taxas Locais do B/L e retirar a isenção, com justificativa', can: ALL, proof: ['caso: P2: qualquer Departamento isenta as Taxas Locais'] },
  { id: 'desativar-tarifa', group: 'taxas', action: 'Desativar, reativar e excluir tarifa e tipo de container; corrigir item de tabela já usada e editar Condição de Cliente', can: ADM, proof: ['caso: P9:', 'caso: P9T:', 'caso: B13:', 'caso: Catálogo: item de tabela ainda sem uso'] },
  { id: 'emitir-fatura', group: 'taxas', action: 'Emitir fatura (do B/L, na Validação, consolidada, avulsa) e corrigir fatura emitida', can: ALL, proof: ['caso: A9:', 'caso: P4:'] },
  { id: 'autorizar-restituicao', group: 'taxas', action: 'Autorizar restituição excepcional e cancelar a autorização', can: ALL, proof: ['caso: P5: %s lê a Conciliação, autoriza restituição'] },
  { id: 'baixa-restituicao', group: 'taxas', action: 'Registrar pagamento (baixa manual) e confirmar Restituição', can: FIN_DEV, proof: ['caso: P5: baixa manual e conciliar PIX', 'exceção: Registrar a Restituição (fatura)', 'exceção: Registrar a Restituição (Demurrage)'] },
  { id: 'ajuste-cod', group: 'taxas', action: 'Liquidar Ajuste de COD', can: ADM_FIN, proof: ['exceção: Liquidar Ajuste de COD'] },
  // Fatura com pagamento só se cancela depois de cancelada a baixa (_cancel_invoice_core).
  { id: 'cancelar-fatura', group: 'taxas', action: 'Cancelar fatura sem pagamento', can: ADM_FIN, proof: ['exceção: Cancelar fatura', 'exceção: Cancelar fatura consolidada'] },
  { id: 'cancelar-baixa', group: 'taxas', action: 'Cancelar baixa e preparar cancelamento financeiro de B/L', can: FIN_DEV, proof: ['exceção: Cancelar baixa', 'exceção: Preparar cancelamento financeiro de B/L'] },

  // Demurrage
  { id: 'gerar-invoice', group: 'demurrage', action: 'Gerar Invoice e complementar; aplicar desconto; editar tarifa, tipo de container, acordo e condição de Demurrage do B/L', can: ALL, proof: ['caso: P4:', 'caso: P5: %s lê a Conciliação, autoriza restituição e aplica desconto', 'caso: P9:', 'caso: P9T:', 'todos: Condição de Demurrage do B/L'] },
  { id: 'disputas', group: 'demurrage', action: 'Ver Disputas e editar os dados da disputa e o vencimento', can: ALL, proof: ['caso: P12: %s lê o Desbloqueio de CE com os documentos, as Disputas', 'todos: Editar os dados da disputa'] },
  // ADR 0112, D24 (migrations 517 e 530): qualquer setor, justificativa de ao menos 10 caracteres.
  { id: 'dispensar-cobranca', group: 'demurrage', action: 'Dispensar a cobrança de Demurrage de um container e desfazer a dispensa, com justificativa', can: ALL, proof: ['todos: Dispensar a cobrança de Demurrage', 'todos: Desfazer a dispensa de Demurrage'] },
  { id: 'baixa-invoice', group: 'demurrage', action: 'Registrar pagamento de Invoice', can: FIN_DEV, proof: ['exceção: Baixa de Invoice de Demurrage'] },
  { id: 'informar-ptax', group: 'demurrage', action: 'Informar PTAX; pôr e tirar o ROE manual do B/L e tirar o da Invoice, com motivo', can: ADM_FIN_EQU, proof: ['exceção: Informar PTAX', 'exceção: Pôr e tirar o ROE manual do B/L', 'exceção: Tirar o ROE manual da Invoice de Demurrage'] },
  { id: 'responder-disputa', group: 'demurrage', action: 'Responder, reabrir e anexar na Disputa', can: only('administrativo', 'equipamentos'), proof: ['exceção: Responder Disputa', 'exceção: Reabrir Disputa'] },
  // Invoice paga só se cancela depois de cancelada a baixa (cancel_demurrage_invoice).
  { id: 'cancelar-invoice', group: 'demurrage', action: 'Cancelar Invoice sem pagamento; mudar o intervalo da Régua', can: ADM_FIN_EQU, proof: ['exceção: Cancelar Invoice de Demurrage', 'exceção: Intervalo da Régua'] },
  { id: 'cancelar-baixa-invoice', group: 'demurrage', action: 'Cancelar baixa de Invoice', can: FIN_DEV, proof: ['exceção: Cancelar baixa de Demurrage'] },

  // Conciliação Pix
  { id: 'ver-conciliacao', group: 'pix', action: 'Ver a fila, as exceções e o monitor Itaú', can: ALL, proof: ['caso: P5: %s lê a Conciliação'] },
  { id: 'conciliar', group: 'pix', action: 'Conciliar: vincular, confirmar, tratar exceção, marcar recebimento Itaú', can: FIN_DEV, proof: ['caso: P5: baixa manual e conciliar PIX', 'caso: P5: baixa por TXID só pela confirmação do lote'] },

  // Clientes, Comunicação e Portal
  { id: 'editar-cliente', group: 'clientes', action: 'Editar Cliente; ler o Histórico de Comunicados e o console do Portal; trazer Cliente pela Base de Clientes e pela Revisão', can: ALL, proof: ['todos: Editar Cliente', 'todos: Ler o Histórico de Comunicados', 'caso: A18:'] },
  // Decisão do dono de 2026-10-27 (ficha ACE-D01, opção A): todos agem em Comunicação; contatos seguem com três setores.
  { id: 'disparar-comunicado', group: 'clientes', action: 'Disparar Comunicado e salvar modelo; ler o estado da chave de envio', can: ALL, proof: ['todos: Salvar modelo de Comunicado', 'caso: Dev: todos os setores leem a chave de envio'] },
  { id: 'contatos-comunicados', group: 'clientes', action: 'Editar contatos e Caixas de Comunicação', can: ADM_DOC_EQU, proof: ['exceção: Editar contatos do Cliente', 'caso: P3: a tela edita contatos pela RPC'] },
  { id: 'novo-cliente', group: 'clientes', action: 'Criar Cliente pelo Novo cliente (grava os contatos)', can: ADM_DOC_EQU, proof: ['exceção: Criar Cliente pelo Novo cliente'] },
  { id: 'provisionar-portal', group: 'clientes', action: 'Provisionar o Portal: convite (enviar e cancelar), conta, e-mail de recuperação, reabrir análise', can: ADM_DOC, proof: ['exceção: Cancelar convite do Portal', 'exceção: Trocar o e-mail de recuperação do Portal', 'exceção: Liberar e-mail bloqueado do Portal', 'exceção: Reabrir análise do Portal'] },
  { id: 'desativar-cliente', group: 'clientes', action: 'Desativar e reativar Cliente; trocar o CNPJ do Portal; Liberação de faturamento', can: ADM, proof: ['exceção: Desativar Cliente', 'exceção: Reativar Cliente', 'exceção: Trocar o CNPJ do Portal', 'exceção: Conceder Liberação de faturamento', 'exceção: Revogar Liberação de faturamento'] },

  // Desbloqueio de CE
  { id: 'ver-desbloqueio', group: 'ce', action: 'Ver pedidos e abrir documentos', can: ALL, proof: ['caso: P12: %s lê o Desbloqueio de CE'] },
  { id: 'gerir-desbloqueio', group: 'ce', action: 'Gerir pedidos, documentos, exportação para a ZPT e conciliação', can: ADM_DOC, proof: ['exceção: Gerir o Desbloqueio de CE', 'caso: P12: gerir o Desbloqueio de CE e responder Disputas seguem restritos'] },

  // Alertas
  {
    id: 'alertas-do-setor', group: 'alertas', action: 'Recebe os alertas do próprio setor',
    can: {
      administrativo: `${alertTypes(ALERT_TYPE_COUNTS.administrativo)} (inclusive os quatro críticos de contato e Portal e, desde 2026-11-06, Tabela de cobrança faltando, Cálculo bloqueado e Portal não provisionado da Documentação, e o Calendário de feriados, só na conta Dev); também os críticos de setor sem ninguém ativo`,
      financeiro: `${alertTypes(ALERT_TYPE_COUNTS.financeiro)} (do próprio setor: Pix não conciliado e Restituição pendente; avisado em Fatura desatualizada e Taxa alterada à mão mudou)`,
      operacoes: alertTypes(ALERT_TYPE_COUNTS.operacoes),
      documentacao: alertTypes(ALERT_TYPE_COUNTS.documentacao),
      equipamentos: alertTypes(ALERT_TYPE_COUNTS.equipamentos),
    },
    proof: ['caso: Catálogo: cada setor recebe os tipos de alerta que a tela diz', 'caso: P5: Pix não conciliado e Restituição pendente são do Financeiro; Fatura desatualizada o avisa; Consulta Itaú é da conta Dev'],
  },
  // Migration 603 (ADR 0130): a gravidade de cada alerta, na tela Regras de alertas.
  { id: 'alertas-gravidade', group: 'alertas', action: 'Trocar a gravidade de um alerta (Crítico ou Normal) e o reforço por tempo, com motivo', can: ADM, proof: ['exceção: Trocar a gravidade de um alerta', 'exceção: Definir o reforço por tempo de um alerta'] },
]

/** O setor pode a ação (✓ ou com condição). */
export function departmentCan(row: PermissionRow, department: Department): boolean {
  return row.can[department] !== false
}

/** Setores que podem a ação (✓ ou com condição), na ordem das colunas. */
export function allowedDepartments(row: PermissionRow): Department[] {
  return DEPARTMENTS.filter((department) => departmentCan(row, department))
}

/**
 * Setores em que qualquer usuário ativo passa da guarda, sem precisar da
 * marca Dev: o que a bateria por perfil confere com os cinco perfis comuns.
 */
export function allowedWithoutDevMark(row: PermissionRow): Department[] {
  return allowedDepartments(row).filter((department) => row.can[department] !== DEV_ONLY)
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
