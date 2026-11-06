import { AGENCY_REPORT_SECTIONS, AGENCY_REPORT_SECTION_LABELS, type AgencyReportSection } from './agencyDepartureReport'
import { ENTITY_TYPE_LABELS, TYPE_LABELS, type ActiveAlertType } from './alerts'

// Catálogo da tela Regras de alertas (`/alertas/regras`): o que cada alerta
// vivo quer dizer, em linguagem de quem opera o Vela. Os textos seguem o
// capítulo 20 do Manual do Operador e os assuntos dele (20.4 a 20.13).
//
// Regra de escrita (pedido do dono de 2026-11-06, ADR 0130): a tela não fala
// de migration, função, tabela, rotina técnica nem endereço de tela. A origem
// técnica de cada regra fica nos comentários deste arquivo, para quem mantém
// o código.
//
// O manual só documenta regras vivas: um tipo sem produtor sai desta lista na
// mesma mudança que o aposenta no catálogo SQL, para a tela não prometer um
// alerta que nunca chega. O histórico da aposentadoria fica no CHANGELOG e nas
// migrations que a executaram.

/** Assunto da regra: as seções 20.4 a 20.13 do Manual do Operador. */
export type AlertRuleDomain =
  | 'Viagem e datas'
  | 'Documentação e importação'
  | 'Cliente e Portal'
  | 'Comunicados e e-mail'
  | 'Faturamento e Taxas Locais'
  | 'Demurrage'
  | 'Pix e pagamento'
  | 'Desbloqueio de CE'
  | 'ADR de Saída'
  | 'Rotinas paradas'
export type AlertRuleDepartment = 'documentacao' | 'equipamentos' | 'operacoes' | 'financeiro' | 'administrativo'
export type AlertRuleSeverity = 'critical' | 'normal'

export type AlertRule = {
  type: ActiveAlertType
  label: string
  domain: AlertRuleDomain
  /**
   * Setores que aparecem como responsáveis na fila `/alertas`: é o
   * `alert_items.department` gravado pelo produtor. Quase todo tipo grava um
   * único setor; o ADR grava um item por departamento.
   */
  responsibleDepartments: AlertRuleDepartment[]
  /**
   * Espelha `alert_type_catalog.audience_departments` (migrations 476 e
   * 485): o setor responsável e as exceções do dono — o Financeiro nos tipos
   * do dinheiro e o Administrativo nos quatro críticos da Documentação.
   */
  catalogAudience: AlertRuleDepartment[]
  /**
   * Derivado: quem recebe a notificação interna. Desde a migration 476 o sino
   * é do setor responsável pelo item (`fanout_alert_item_for_department`),
   * mais os setores das exceções da audiência do catálogo.
   */
  notifiedDepartments: AlertRuleDepartment[]
  /** Quem recebe ou quem faz, quando não é óbvio pelo setor. */
  routingNote?: string
  entityType: keyof typeof ENTITY_TYPE_LABELS
  /**
   * Gravidade de fábrica, a do `alert_type_catalog` semeado pelas migrations.
   * Desde a migration 603 o Administrativo troca a gravidade na tela; a
   * vigente vem de `list_alert_type_settings` (`useAlertTypeSettings`).
   */
  severity: AlertRuleSeverity
  /** O que é: o fato, em uma ou duas frases. */
  summary: string
  /** Quando abre: a condição. */
  trigger: string
  /** Em que momento aparece (na gravação, na conferência de 15 minutos...). */
  timing: string
  /** O que fazer. */
  resolution: string
  destination: string
  destinationLabel: string
  destinationNote?: string
  /** Quando fecha. */
  afterResolution: string
  /** Se ninguém agir: o que fica parado ou errado, e para quem. */
  impact: string
}

type AlertRuleDraft = Omit<AlertRule, 'label' | 'notifiedDepartments' | 'responsibleDepartments'> & {
  /**
   * Omitido quando o produtor grava sempre o mesmo setor: nesse caso o
   * responsável é o único item da audiência do catálogo declarado como dono.
   */
  responsibleDepartments?: AlertRuleDepartment[]
  responsible: AlertRuleDepartment
}

export const ALERT_RULE_DEPARTMENTS: AlertRuleDepartment[] = ['documentacao', 'equipamentos', 'operacoes']
// Financeiro: setor de Pix não conciliado, Consulta do Itaú parada e
// Restituição pendente desde a migration 587; avisado nos outros do dinheiro.
const DEPARTMENT_ORDER: AlertRuleDepartment[] = [...ALERT_RULE_DEPARTMENTS, 'financeiro', 'administrativo']

export const ALERT_RULE_DEPARTMENT_LABELS: Record<AlertRuleDepartment, string> = {
  documentacao: 'Documentação',
  equipamentos: 'Equipamentos',
  operacoes: 'Operações',
  financeiro: 'Financeiro',
  administrativo: 'Administrativo',
}

// Tipos de origem externa (migrations 476 e 485): fecham sozinhos ou com
// justificativa, que segura o alerta por 24 horas.
const closesOrHeld = 'Sozinho, quando a causa some. Se ela não depende da equipe (o suporte técnico já assumiu, o fornecedor está fora do ar), use Resolver com a justificativa: o alerta sai da fila por 24 horas e volta antes se a causa sumir e reaparecer.'
// Conferência sem fato de origem (ADR 0083, item 23; migration 238).
const closesWithJustification = 'Só com justificativa: depois de conferir, use Resolver na fila. A justificativa fica no histórico do alerta com o seu nome.'
const detectorRound = 'Na conferência automática de 15 minutos'

// Ordem canônica dos departamentos do ADR no detector SQL
// (`reconcile_agency_report_alerts`, migrations 323/342).
const AGENCY_REPORT_DEPARTMENTS: AlertRuleDepartment[] = ['operacoes', 'documentacao', 'equipamentos']

// Espelha `agency_report_section_owner`: cada seção do ADR pertence a um
// departamento e o detector abre um item por departamento com seção pendente.
export function agencyReportSectionsByDepartment(department: AlertRuleDepartment): string[] {
  return (Object.keys(AGENCY_REPORT_SECTIONS) as AgencyReportSection[])
    .filter((section) => AGENCY_REPORT_SECTIONS[section] === department)
    .map((section) => AGENCY_REPORT_SECTION_LABELS[section])
}

function agencyReportOwnershipSentence(): string {
  return AGENCY_REPORT_DEPARTMENTS
    .map((department) => `${ALERT_RULE_DEPARTMENT_LABELS[department]} (${agencyReportSectionsByDepartment(department).join(', ')})`)
    .join('; ')
}

const ALERT_RULES_BASE = [
  // 20.4 Viagem e datas ------------------------------------------------------
  {
    // Migration 584 (ADR 0121): frente sem terminal cobrada a partir do D-5 da escala.
    type: 'voyage_escala_terminal_missing',
    domain: 'Viagem e datas',
    responsible: 'operacoes',
    catalogAudience: ['operacoes'],
    entityType: 'voyage_pod_schedule',
    severity: 'critical',
    summary: 'A escala vai chegar, ou já chegou, com uma frente de operação sem terminal.',
    trigger: 'Cinco dias antes do ETA da escala, se alguma frente está sem terminal: gravada em TBC, ou a carga que chegou depois (B/L, vazios, carga solta, Granito, Embarque de vazios) ainda sem terminal. Abre de novo, e avisa outra vez, no ATA, se a frente continua sem terminal. Também abre quando um terminal tem ATB e nenhuma frente.',
    timing: `${detectorRound} do 5º dia antes do ETA e no fim de cada gravação da escala. A carga importada depois entra na conferência seguinte.`,
    resolution: 'Abra a Viagem e escolha o terminal de cada frente em Editar escala.',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens',
    afterResolution: 'Sozinho, quando toda frente da escala tem terminal.',
    impact: 'Sem terminal, a carga da frente fica fora do Aviso de Atracação (NOB) ao Cliente, do ADR de Saída e do EDI Mercante, e o Fechar ADR fica travado.',
  },
  {
    // Migrations 342 e 346: a escala cobra ATA e ETB; o terminal cobra o resto.
    type: 'voyage_schedule_date_pending',
    domain: 'Viagem e datas',
    responsible: 'operacoes',
    catalogAudience: ['operacoes'],
    entityType: 'voyage_pod_schedule',
    severity: 'normal',
    summary: 'Uma escala está sem a data que o navio já devia ter.',
    trigger: 'No dia do ETA (horário de Brasília), se a escala não tem ATA. Com o ATA, se a escala não tem terminal nenhum nem frente para atribuir. A frente sem terminal é cobrada em Escala sem terminal; com terminal, o ETB é cobrado em Data de terminal pendente.',
    // 606 (ADR 0131, D3): 16 horas depois do ETA sem ATA, Crítico pelo marco.
    timing: `${detectorRound} no dia do ETA e no fim de cada gravação da escala. Se o ATA não entra até 16 horas depois do ETA, o alerta vira Crítico e avisa de novo.`,
    resolution: 'Abra a Viagem e registre o ATA da escala, ou escolha o terminal e o ETB em Editar escala.',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens',
    afterResolution: 'Sozinho, na gravação da data.',
    impact: 'Sem o ATA, o Aviso de Chegada (NOR) não sai para os Clientes, e o Line-Up e o Portal mostram o navio como ainda não chegado.',
  },
  {
    // Migrations 342 e 346 (dia de Brasília): ETB, ATB, ETD e ATD por terminal.
    type: 'voyage_terminal_date_pending',
    domain: 'Viagem e datas',
    responsible: 'operacoes',
    catalogAudience: ['operacoes'],
    entityType: 'voyage_escala_terminal',
    severity: 'normal',
    summary: 'Uma atracação está sem a data do terminal que já devia ter.',
    trigger: 'Para cada terminal: com o ATA da escala, enquanto falta o ETB; no dia do ETB, sem ATB; com o ATB, enquanto falta o ETD; no dia do ETD, sem ATD.',
    // 606 (ADR 0131, D3): 16 horas depois do ETD sem ATD, Crítico pelo marco.
    timing: `${detectorRound} no dia da data prevista, ou logo depois de a data anterior ser gravada. Cada terminal da escala tem a própria sequência. Se o ATD não entra até 16 horas depois do ETD, o alerta vira Crítico e avisa de novo.`,
    resolution: 'Abra a Viagem e registre a data cobrada no cartão do terminal.',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens',
    afterResolution: 'Sozinho, na gravação da data.',
    impact: 'Sem o ATB, o Aviso de Atracação (NOB) não sai. Sem o ATD, o prazo de 72 horas do ADR de Saída não começa, os alertas do ADR e da exportação não abrem e a Viagem não é concluída.',
  },
  {
    // Migrations 338 e 346: o item é da escala, e a conferência é pela Viagem.
    type: 'voyage_export_after_atd',
    domain: 'Viagem e datas',
    responsible: 'equipamentos',
    catalogAudience: ['equipamentos'],
    routingNote: 'De Equipamentos desde 2026-11-06: é quem lança o Granito e o Embarque de vazios e assina essas seções do ADR de Saída.',
    entityType: 'voyage_pod_schedule',
    severity: 'normal',
    summary: 'O navio já saiu de um terminal de uma escala com exportação declarada, e a exportação não foi lançada na Viagem.',
    trigger: 'Com o ATD num terminal de escala que declarou exportação de Granito ou de vazios, enquanto o Granito ou o Embarque de vazios previsto não está na Viagem.',
    timing: 'No ATD do terminal e na conferência de 15 minutos.',
    resolution: 'Na aba Exportação da Viagem, importe o Granito ou inclua as unidades no Embarque de vazios; ou corrija a exportação declarada na escala.',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens',
    afterResolution: 'Sozinho, quando a exportação é lançada ou a declaração é corrigida. A conferência é pela Viagem, não pelo porto: numa Viagem com exportação em dois portos, lançar a de um fecha também o alerta do outro.',
    impact: 'A carga embarcada fica fora do ADR de Saída e dos serviços de exportação lançados para cobrança.',
  },

  // 20.5 Documentação e importação -------------------------------------------
  {
    // Migrations 341 e 346: D-7 do primeiro ETA brasileiro, portos normalizados.
    type: 'voyage_bl_expected',
    domain: 'Documentação e importação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage',
    severity: 'critical',
    summary: 'Faltam 7 dias para o navio chegar ao Brasil e ainda falta B/L para algum porto da Viagem.',
    trigger: 'No sétimo dia antes do primeiro ETA no Brasil (D−7), se algum porto de descarga da Viagem, ou porto de embarque com saída programada, não tem B/L.',
    timing: `${detectorRound} do D−7; conferido de novo a cada B/L importado, movido ou cancelado.`,
    resolution: 'Confira a Viagem e importe os B/Ls que faltam.',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens',
    afterResolution: 'Sozinho, quando todo porto esperado tem B/L.',
    impact: 'Sem o B/L, a carga fica sem Cliente para os avisos de chegada, o CE Mercante e a fatura. Um B/L que divide container e chega depois do CE refaz a divisão do container e a fatura de quem já foi faturado.',
  },
  {
    // Migrations 324 e 341: fecha na importação do Baplie.
    type: 'voyage_baplie_missing',
    domain: 'Documentação e importação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage',
    severity: 'critical',
    summary: 'Faltam 7 dias para o navio chegar ao Brasil e o Baplie ainda não foi importado.',
    trigger: 'No D−7 do primeiro ETA no Brasil, sem nenhum Baplie importado para a Viagem.',
    timing: `${detectorRound} do D−7.`,
    resolution: 'Importe o Baplie em Baplie EDI.',
    destination: '/baplie',
    destinationLabel: 'Abrir Baplie EDI',
    afterResolution: 'Sozinho, na importação do Baplie.',
    impact: 'Sem o Baplie, os B/Ls não recebem as marcas IMO e OOG, que mudam as Taxas Locais, e a conferência dos containers com os B/Ls não acontece.',
  },
  {
    // Migration 324: cobertura documental Baplie × B/L.
    type: 'voyage_baplie_documentary_coverage',
    domain: 'Documentação e importação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage',
    severity: 'critical',
    summary: 'O Baplie e os B/Ls da Viagem não batem.',
    trigger: 'Há container cheio no Baplie sem B/L, ou container de B/L que não está entre os cheios do Baplie. Antes do D−7, só conta nas rotas que já têm B/L. A mensagem diz quantos.',
    timing: 'Na importação do Baplie ou do B/L e a cada mudança de container.',
    resolution: 'Em Baplie EDI, abra a Conciliação Baplie × B/L e corrija o B/L ou o Baplie; peça ao armador o documento que falta.',
    destination: '/baplie',
    destinationLabel: 'Abrir Baplie EDI',
    afterResolution: 'Sozinho, quando o Baplie e os B/Ls batem.',
    impact: 'Container sem B/L fica sem Cliente e sem cobrança; B/L com container errado pode ser faturado e informado errado.',
  },
  {
    // Migrations 324, 341 e 346: D-5, B/L vivo sem CE ou rota VAZIOS sem número.
    type: 'voyage_ce_mercante_missing',
    domain: 'Documentação e importação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage',
    severity: 'critical',
    summary: 'Faltam 5 dias para o navio chegar ao Brasil e ainda há B/L sem CE Mercante ou rota de vazios sem o Nº de Manifesto Mercante.',
    trigger: 'No quinto dia antes do primeiro ETA no Brasil (D−5), com B/L ativo sem CE ou rota de vazios sem Nº de Manifesto Mercante.',
    timing: `${detectorRound} do D−5; conferido de novo a cada CE e a cada número informado.`,
    resolution: 'Importe a planilha de CE e, na aba Rotas e Manifestos da Viagem, informe o Nº de Manifesto Mercante das rotas de vazios. Se a prévia disser que o CE está travado pela resposta de veículos, quem destrava é Equipamentos.',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens',
    afterResolution: 'Sozinho, quando todo B/L tem CE e toda rota de vazios tem o número.',
    impact: 'Sem o CE, a fatura não sai, o Cliente não recebe o CE e Taxas, o B/L não aparece no Portal e o Desbloqueio de CE não começa.',
  },
  {
    // Migration 597 (ADR 0128): resposta de Equipamentos em D-7.
    type: 'voyage_vehicle_declaration_pending',
    domain: 'Documentação e importação',
    responsible: 'equipamentos',
    catalogAudience: ['equipamentos'],
    entityType: 'voyage',
    severity: 'normal',
    summary: 'Faltam 7 dias para o navio chegar ao Brasil e Equipamentos ainda não respondeu se a Viagem terá veículos.',
    trigger: 'No D−7 do primeiro ETA no Brasil, se a Viagem tem B/L de container, nenhum veículo importado e nenhuma resposta.',
    timing: `${detectorRound} do D−7; conferido de novo quando entram veículos, quando a resposta é dada, trocada ou desfeita e quando os B/Ls ou o ETA mudam. No D−5 sem resposta, dá lugar a Planilha de Veículos ausente, que é crítico.`,
    resolution: 'Em Veículos, clique em Esta viagem terá veículos ou Esta viagem não terá veículos, ou importe a planilha.',
    destination: '/veiculos',
    destinationLabel: 'Abrir Veículos',
    destinationNote: 'O alerta abre Veículos já na Viagem.',
    afterResolution: 'Sozinho, quando a resposta é dada ou os veículos entram. Desfazer a resposta, com motivo, reabre o alerta dentro do prazo.',
    impact: 'Sem a resposta, a Documentação não consegue vincular o CE Mercante dos B/Ls de container da Viagem.',
  },
  {
    // Migrations 468 e 597 (ADR 0128): crítico em D-5, trava o CE.
    type: 'voyage_vehicle_sheet_pending',
    domain: 'Documentação e importação',
    responsible: 'equipamentos',
    catalogAudience: ['equipamentos'],
    entityType: 'voyage',
    severity: 'critical',
    summary: 'Faltam 5 dias para o navio chegar ao Brasil, a Viagem tem B/L de container e a planilha de Veículos ainda não entrou.',
    trigger: 'No D−5 do primeiro ETA no Brasil, sem veículo importado, com a Viagem declarada com veículos ou ainda sem resposta.',
    timing: `${detectorRound} do D−5, junto com o CE Mercante pendente.`,
    resolution: 'Em Veículos, importe a planilha. Se a Viagem não trouxer veículos, declare (ou use Trocar para sem veículos, com motivo).',
    destination: '/veiculos',
    destinationLabel: 'Abrir Veículos',
    destinationNote: 'O alerta abre Veículos já na Viagem.',
    afterResolution: 'Sozinho, quando os veículos entram ou a Viagem é declarada sem veículos. Desfazer a resposta, com motivo, reabre o alerta dentro do prazo.',
    impact: 'O CE Mercante dos B/Ls de container fica travado: sem CE, não há fatura, CE e Taxas nem Desbloqueio de CE.',
  },
  {
    // Migration 396 (ADR 0095, decisão 20).
    type: 'ce_fora_do_manifesto_da_rota',
    domain: 'Documentação e importação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'bl',
    severity: 'normal',
    summary: 'Um B/L com CE Mercante mudou de rota (porto de embarque, porto de descarga ou Viagem) e saiu do Manifesto Mercante, mas o CE ficou.',
    trigger: 'A mudança de rota de um B/L ativo com CE deixa o B/L sem Manifesto Mercante. Um alerta por B/L.',
    timing: 'Na gravação da mudança de rota.',
    resolution: 'Inclua o B/L no Manifesto Mercante da rota nova (Mover ou planilha de CE) ou corrija o CE na ficha do B/L.',
    destination: '/bls',
    destinationLabel: 'Abrir B/L',
    destinationNote: 'O alerta abre a ficha do B/L.',
    afterResolution: 'Sozinho, quando o CE é trocado ou removido, quando o B/L entra num Manifesto Mercante ou é cancelado. Excluir o B/L apaga o alerta.',
    impact: 'O CE do B/L não corresponde a nenhum Manifesto Mercante da rota nova, e o B/L fica fora do manifesto dela.',
  },
  {
    // Migrations 025, 348 e 252: efeito pós-commit bloqueado; Reprocessar.
    type: 'import_effect_blocked',
    domain: 'Documentação e importação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'import_effect',
    severity: 'critical',
    summary: 'Um passo que roda logo depois da importação falhou e parou: por exemplo, calcular as Taxas Locais, emitir a fatura pelo CE ou emitir a Invoice de Demurrage.',
    trigger: 'O passo falhou por um dado que precisa de correção, ou esgotou as novas tentativas automáticas. B/L na Revisão ou sem tabela de cobrança não conta: o passo espera sem alerta e segue sozinho.',
    timing: 'Na hora em que o passo para. A mensagem diz o B/L e o motivo; o texto do sistema fica em Detalhe técnico.',
    resolution: 'Corrija a causa que o alerta aponta e use Reprocessar no próprio alerta, com justificativa.',
    destination: '/alertas',
    destinationLabel: 'Abrir Alertas',
    afterResolution: 'Depois do Reprocessar, fica como Reprocessando… e fecha quando o passo termina, ou quando o B/L ou a Viagem são excluídos. Se parar de novo, volta com o novo motivo.',
    impact: 'O que o passo faria fica parado para aquele B/L: as Taxas Locais, a fatura pelo CE ou a Invoice de Demurrage.',
  },
  {
    // Migrations 170 e 324: um item por consignatário (ou 'sem_cliente').
    type: 'review_customer_unlinked',
    domain: 'Documentação e importação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'customer',
    severity: 'critical',
    summary: 'Um B/L chegou à Revisão sem Cliente vinculado.',
    trigger: 'Há B/L na Revisão sem Cliente. Um alerta por consignatário, com os B/Ls dele.',
    timing: 'Na hora em que o B/L entra na Revisão sem Cliente. Quando o ETA do porto fica a 5 dias, a linha ganha na fila o selo ETA próximo.',
    resolution: 'Na Revisão, abra o grupo do consignatário e cadastre o Cliente novo ou vincule a um Cliente já cadastrado: um cadastro resolve todos os B/Ls do grupo.',
    destination: '/revisao',
    destinationLabel: 'Abrir Revisão',
    afterResolution: 'Sozinho, quando os B/Ls do grupo ganham Cliente, saem da Revisão ou são cancelados.',
    impact: 'Sem Cliente, o B/L não é faturado, o Cliente não recebe o CE e Taxas nem os avisos de chegada e não vê o B/L no Portal.',
  },
  {
    // Migrations 324 e 352: crítico perto do ETA, cobre todo B/L vivo sem Cliente.
    type: 'review_breakbulk_weight_missing',
    domain: 'Documentação e importação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'customer',
    severity: 'critical',
    summary: 'Um B/L de carga solta está na Revisão sem o peso. Na carga solta, o peso define a cobrança das Taxas Locais.',
    trigger: 'B/L de carga solta ou misto na Revisão com o peso ausente ou abaixo do mínimo aceito.',
    timing: 'Na hora em que o B/L entra na Revisão sem o peso.',
    resolution: 'Na Revisão, digite o peso em Peso (t), no grupo do Cliente, e salve.',
    destination: '/revisao',
    destinationLabel: 'Abrir Revisão',
    afterResolution: 'Sozinho, quando o peso é informado.',
    impact: 'O B/L não sai da Revisão: a fatura e o CE e Taxas do Cliente ficam parados.',
  },
  {
    // Migrations 083, 343 e 350: Portal pronto para faturar ou Liberação.
    type: 'review_portal_not_ready',
    domain: 'Documentação e importação',
    responsible: 'documentacao',
    // 605 (ADR 0131, D7): avisa também o Administrativo.
    catalogAudience: ['documentacao', 'administrativo'],
    routingNote: 'Avisa também o Administrativo, que concede a Liberação de faturamento sem Portal.',
    entityType: 'customer',
    severity: 'critical',
    summary: 'O Cliente tem B/L parado na Revisão, ou fatura retida, porque o Portal dele não está pronto e não há Liberação de faturamento.',
    trigger: 'Cliente sem o Portal pronto para faturar e sem Liberação de faturamento vigente, com B/L na Revisão ou fatura retida pelo CE.',
    timing: 'Na hora em que o B/L fica retido; também às 00h13, quando uma Liberação de faturamento vence.',
    resolution: 'Em Clientes › Portal, leve a conta do Cliente a pronta (convite enviado e conta ativada). Se o Cliente precisar faturar antes, peça ao Administrativo a Liberação de faturamento sem Portal.',
    destination: '/clientes/portal',
    destinationLabel: 'Abrir Clientes e Portal',
    afterResolution: 'Sozinho, quando o Portal fica pronto ou o Administrativo concede a Liberação; as faturas retidas saem em seguida.',
    impact: 'A fatura não sai: o Cliente não recebe o CE e Taxas e não consegue pagar, e sem pagamento o Desbloqueio de CE não começa.',
  },
  {
    // Migration 352: 5 dias antes do ETA da escala, um por escala.
    type: 'bl_sem_cliente_perto_eta',
    domain: 'Documentação e importação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage_pod_schedule',
    severity: 'critical',
    summary: 'Faltam 5 dias ou menos para o navio chegar a um porto, e algum B/L desse porto ainda está sem Cliente.',
    trigger: 'B/L não cancelado sem Cliente, cujo porto de descarga tem ETA em 5 dias ou menos (ou já passado). Escala excluída ou omitida não conta. Um alerta por escala, com quantos B/Ls faltam.',
    timing: 'Na virada do dia em que o ETA fica a 5 dias (conferência de 15 minutos), ou na hora em que um B/L sem Cliente entra numa escala que já está no prazo ou o ETA é antecipado.',
    resolution: 'Resolver abre a Revisão já nos B/Ls sem Cliente da Viagem: vincule cada um (dá para vincular vários de uma vez pelo consignatário). O B/L que não vai seguir, peça ao Administrativo que cancele.',
    destination: '/revisao?causa=cliente',
    destinationLabel: 'Abrir Revisão',
    destinationNote: 'O alerta abre a Revisão já na Viagem da escala, com os B/Ls sem Cliente de todos os portos dela.',
    afterResolution: 'Sozinho, quando o último B/L ganha Cliente, é cancelado, excluído ou muda de escala; quando o ETA é adiado para mais de 5 dias; ou quando a escala é excluída ou omitida ou a Viagem é cancelada.',
    impact: 'Esses Clientes não recebem o NOA nem os outros avisos da chegada, e os B/Ls deles não são faturados nem aparecem no Portal.',
  },
  {
    // Migration 213; não abre desde a 392 (aba VIN ignorada). Itens antigos com justificativa.
    type: 'bl_vehicles_changed_on_reimport',
    domain: 'Documentação e importação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'bl',
    severity: 'normal',
    summary: 'Alerta antigo: a reimportação de um B/L trocou a lista de veículos.',
    trigger: 'Não abre mais: os veículos entram só pela planilha de Veículos, e a reimportação do B/L não mexe neles. Os alertas antigos ainda abertos se resolvem com justificativa.',
    timing: 'Abria no fim da importação, um por B/L.',
    resolution: 'Confira na ficha do B/L os veículos e o local de desova e resolva com justificativa.',
    destination: '/bls',
    destinationLabel: 'Abrir o B/L',
    afterResolution: closesWithJustification,
    impact: 'Nenhum novo: a regra existe só para fechar os alertas antigos.',
  },

  // 20.6 Cliente e Portal ----------------------------------------------------
  {
    // Migrations 347 e 350: processo ativo = B/L não cancelado e não pago, ou Demurrage em aberto.
    type: 'portal_pendencia_geral',
    domain: 'Cliente e Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'customer',
    severity: 'normal',
    summary: 'O Cliente tem processo em andamento, mas o Portal dele não está pronto para uso.',
    trigger: 'Cliente com B/L não cancelado e ainda não pago, ou com Invoice de Demurrage em aberto, sem conta ativa no Portal, sem usuário de acesso ou sem e-mail de recuperação utilizável. A mensagem diz qual.',
    timing: 'Na hora em que a conta, o e-mail de recuperação, os B/Ls ou as Invoices do Cliente mudam; a conferência de 15 minutos confere de novo.',
    resolution: 'Em Clientes › Portal, siga a Ação da linha do Cliente.',
    destination: '/clientes/portal',
    destinationLabel: 'Abrir Clientes e Portal',
    afterResolution: 'Sozinho, quando o Portal fica pronto ou o Cliente fica sem nada em aberto.',
    impact: 'O Cliente não acompanha os B/Ls, as faturas e os avisos pelo Portal, e sem Portal pronto a fatura dele fica retida.',
  },
  {
    // Convite marcado como expirado pela rotina de 15 minutos (48 horas).
    type: 'portal_convite_expirado',
    domain: 'Cliente e Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'customer',
    severity: 'normal',
    summary: 'O convite do Portal passou de 48 horas sem ser ativado pelo Cliente.',
    trigger: 'Convite expirado, com o Cliente com processo em andamento.',
    timing: 'Na conferência de 15 minutos que marca o convite como expirado.',
    resolution: 'Em Clientes › Portal, confira o e-mail e reenvie o convite.',
    destination: '/clientes/portal',
    destinationLabel: 'Abrir Clientes e Portal',
    afterResolution: 'Sozinho, quando o convite é reenviado, a conta fica ativa ou o Cliente fica sem nada em aberto.',
    impact: 'O Cliente não consegue entrar no Portal; enquanto o Portal não fica pronto, a fatura dele fica retida.',
  },
  {
    type: 'portal_falha_envio',
    domain: 'Cliente e Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'customer',
    severity: 'normal',
    summary: 'O e-mail do convite do Portal não saiu.',
    trigger: 'O envio do convite falhou, com o Cliente com processo em andamento.',
    timing: `${detectorRound} depois da falha.`,
    resolution: 'Em Clientes › Portal, confira o e-mail do Cliente e reenvie o convite.',
    destination: '/clientes/portal',
    destinationLabel: 'Abrir Clientes e Portal',
    afterResolution: 'Sozinho, quando o convite sai.',
    impact: 'O Cliente não recebe o convite; enquanto o Portal não fica pronto, a fatura dele fica retida.',
  },
  {
    type: 'portal_email_suprimido',
    domain: 'Cliente e Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'customer',
    severity: 'normal',
    summary: 'O e-mail de recuperação do Portal do Cliente foi bloqueado: voltou como devolvido ou foi marcado como spam.',
    trigger: 'O e-mail de recuperação está bloqueado e o Cliente tem processo em andamento.',
    timing: 'Na hora em que o endereço é bloqueado; a conferência de 15 minutos confere de novo.',
    resolution: 'Em Clientes › Portal, troque o e-mail de recuperação ou libere o endereço bloqueado.',
    destination: '/clientes/portal',
    destinationLabel: 'Abrir Clientes e Portal',
    afterResolution: 'Sozinho, na hora em que o endereço é trocado ou liberado.',
    impact: 'O Cliente não recebe o e-mail para recuperar a senha e pode ficar sem acesso ao Portal.',
  },
  {
    // Edge portal-login: sexta tentativa recusada pelo bloqueio do CNPJ.
    type: 'portal_abuso_login',
    domain: 'Cliente e Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'customer',
    severity: 'critical',
    summary: 'Houve tentativas seguidas de entrada recusadas no Portal de um Cliente.',
    trigger: 'Na sexta tentativa de entrada recusada pelo bloqueio do CNPJ. Um alerta por Cliente.',
    timing: 'Na tentativa recusada.',
    resolution: 'Confira a origem das tentativas e, se preciso, fale com o Cliente. Depois, resolva com justificativa.',
    destination: '/clientes/portal',
    destinationLabel: 'Abrir Clientes e Portal',
    afterResolution: closesWithJustification,
    impact: 'Pode ser alguém tentando entrar na conta do Cliente, ou o próprio Cliente bloqueado sem conseguir acessar.',
  },
  {
    // Migration 485: crítico da Documentação que avisa também o Administrativo.
    type: 'portal_excecao_critica_fatura',
    domain: 'Cliente e Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao', 'administrativo'],
    entityType: 'bl',
    severity: 'critical',
    summary: 'Uma fatura foi emitida sem o Portal do Cliente pronto e sem Liberação de faturamento.',
    trigger: 'Fatura emitida para B/L cujo Cliente não tinha o Portal pronto nem Liberação. Um alerta por B/L.',
    timing: 'Na emissão da fatura.',
    resolution: 'Leve o Portal do Cliente a pronto e, até lá, faça a fatura chegar ao Cliente por outro meio.',
    destination: '/bls',
    destinationLabel: 'Abrir B/Ls',
    destinationNote: 'O alerta abre a aba Faturamento do B/L.',
    afterResolution: 'Sozinho, quando a fatura é paga (mesmo em parte), cancelada ou substituída.',
    impact: 'O Cliente não vê a fatura no Portal e pode não pagar a tempo.',
  },
  {
    // Migration 085: reprocessamento das faturas retidas depois da ativação.
    // Até a 535 o tipo também avisava o retorno de e-mail em investigação;
    // hoje esse caso é `email_retorno_nao_aplicado` (alertas antigos com justificativa, 316).
    type: 'portal_reprocessamento_falhou',
    domain: 'Cliente e Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'bl',
    severity: 'critical',
    summary: 'O Portal do Cliente ficou pronto (ou foi concedida a Liberação), mas a fatura retida de um B/L não saiu por uma falha técnica.',
    trigger: 'A emissão das faturas retidas, depois da ativação do Portal ou da Liberação, falhou num B/L.',
    timing: 'Na ativação do Portal ou na Liberação.',
    resolution: 'Abra o B/L e emita a fatura pela aba Faturamento. Se a falha repetir, avise o suporte técnico.',
    destination: '/bls',
    destinationLabel: 'Abrir B/Ls',
    destinationNote: 'O alerta abre a aba Faturamento do B/L.',
    afterResolution: 'Sozinho, quando a fatura sai.',
    impact: 'O Cliente continua sem a fatura e sem o CE e Taxas.',
  },
  {
    // Migration 485: crítico da Documentação que avisa também o Administrativo.
    type: 'cliente_contato_bounced_sem_alternativa',
    domain: 'Cliente e Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao', 'administrativo'],
    entityType: 'customer',
    severity: 'critical',
    summary: 'Um e-mail devolvido deixou o Cliente sem nenhum contato ativo e válido.',
    trigger: 'O provedor de e-mail avisa a devolução definitiva de um endereço e nenhum outro contato válido resta no cadastro do Cliente.',
    timing: 'Na hora do aviso de devolução; a conferência de 15 minutos confere de novo.',
    resolution: 'Peça um endereço ao Cliente e cadastre o contato na ficha dele, em Cadastro e contatos.',
    destination: '/clientes',
    destinationLabel: 'Abrir Clientes',
    destinationNote: 'O alerta abre a ficha do Cliente.',
    afterResolution: 'Sozinho, quando um contato com e-mail válido é cadastrado.',
    impact: 'Nenhum e-mail do Vela chega ao Cliente: avisos de chegada, CE e Taxas, faturas e cobranças.',
  },
  {
    // Migrations 245 e 485.
    type: 'caixa_sem_destinatario',
    domain: 'Cliente e Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao', 'administrativo'],
    entityType: 'customer',
    severity: 'critical',
    summary: 'Uma caixa de comunicação do Cliente ficou só com e-mails bloqueados: os avisos dessa caixa não têm para quem ir.',
    trigger: 'O salvamento dos contatos deixa uma caixa sem nenhum contato com e-mail válido.',
    timing: 'No salvamento dos contatos.',
    resolution: 'Na ficha do Cliente, ligue à caixa um contato com e-mail válido e clique em Salvar contatos.',
    destination: '/clientes',
    destinationLabel: 'Abrir Clientes',
    destinationNote: 'O alerta abre a ficha do Cliente.',
    afterResolution: 'Sozinho, ao salvar os contatos com destinatário em toda caixa ativa.',
    impact: 'Os e-mails dessa caixa, como os avisos de chegada ou o CE e Taxas, não saem para o Cliente.',
  },
  {
    // Migrations 106, 245 e 485.
    type: 'cliente_sem_contato_principal',
    domain: 'Cliente e Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao', 'administrativo'],
    entityType: 'customer',
    severity: 'critical',
    summary: 'O Cliente está sem contato principal ativo, e um B/L trouxe um e-mail que está desativado no cadastro.',
    trigger: 'Na importação do B/L, o e-mail do consignatário está desativado no cadastro e o Cliente não tem contato principal ativo. O cadastro não é reativado sozinho.',
    timing: 'Na importação do B/L.',
    resolution: 'Na ficha do Cliente, escolha o contato principal (reative o endereço, se for o caso) e clique em Salvar contatos.',
    destination: '/clientes',
    destinationLabel: 'Abrir Clientes',
    destinationNote: 'O alerta abre a ficha do Cliente.',
    afterResolution: 'Sozinho, ao salvar os contatos.',
    impact: 'O cadastro do Cliente fica sem contato principal até alguém decidir qual endereço vale.',
  },

  // 20.7 Comunicados e e-mail ------------------------------------------------
  {
    // Migrations 315 e 353: janela do NOA (5 dias antes do ETA até o ETA).
    type: 'comunicado_noa_pendente',
    domain: 'Comunicados e e-mail',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage_pod_schedule',
    severity: 'normal',
    summary: 'A escala está na janela do NOA (Chegada Próxima) e algum Cliente ainda não recebeu o aviso.',
    trigger: 'Do quinto dia antes do ETA até o ETA, com Cliente com destinatário que ainda não recebeu o NOA. A mensagem lista os Clientes.',
    timing: `${detectorRound}, enquanto a escala está na janela. O NOA sai sozinho logo que fica devido; o alerta mostra o que ficou preso.`,
    resolution: 'Na página Comunicados da viagem (Clientes › Comunicação, pelo navio na Cobertura), veja o que segura o aviso e corrija.',
    destination: '/clientes/comunicacao',
    destinationLabel: 'Abrir Comunicados',
    afterResolution: 'Sozinho, quando o último destinatário recebe o NOA, quando a escala muda (ETA, ATA, exclusão ou omissão) ou quando a janela termina, no ETA.',
    impact: 'O Cliente não é avisado de que o navio está chegando. Se o ETA chega sem o NOA, o alerta fecha sozinho e nada fica registrado de que o aviso não saiu.',
  },
  {
    type: 'comunicado_nor_pendente',
    domain: 'Comunicados e e-mail',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage_pod_schedule',
    severity: 'normal',
    summary: 'O navio chegou (ATA registrado) e algum Cliente ainda não recebeu o NOR (Aviso de Chegada).',
    trigger: 'ATA da escala registrado nos últimos 30 dias, com Cliente com destinatário que ainda não recebeu o NOR. A mensagem lista os Clientes.',
    timing: `${detectorRound}, por até 30 dias depois do ATA.`,
    resolution: 'Na página Comunicados da viagem, veja o que segura o aviso e corrija.',
    destination: '/clientes/comunicacao',
    destinationLabel: 'Abrir Comunicados',
    afterResolution: 'Sozinho, quando o último destinatário recebe o NOR, quando a escala é excluída ou omitida, ou 30 dias depois do ATA.',
    impact: 'O Cliente não fica sabendo que o navio chegou.',
  },
  {
    // Migration 243: NOB por atracação; item da escala para carga sem terminal.
    type: 'comunicado_nob_pendente',
    domain: 'Comunicados e e-mail',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage_escala_terminal',
    severity: 'normal',
    summary: 'O navio atracou (ATB registrado) e algum Cliente ainda não recebeu o NOB (Aviso de Atracação); ou um Cliente tem carga que não está em terminal nenhum.',
    trigger: 'ATB da atracação registrado nos últimos 30 dias, com Cliente daquele terminal que ainda não recebeu o NOB. Com ATB na escala, um alerta da escala lista também os Clientes cujos B/Ls não estão em nenhuma atracação (frente sem terminal, ou B/L misto com a carga em terminais diferentes).',
    timing: `${detectorRound}, por até 30 dias depois do ATB.`,
    resolution: 'Na página Comunicados da viagem, confira os B/Ls daquele terminal e o que segura o aviso. No alerta da escala, escolha o terminal da frente em Editar escala ou defina a exceção de terminal do B/L misto.',
    destination: '/clientes/comunicacao',
    destinationLabel: 'Abrir Comunicados',
    afterResolution: 'Sozinho, quando o último destinatário recebe o NOB, quando a escala é excluída ou omitida, ou 30 dias depois do ATB. O alerta da escala fecha quando todo B/L tem terminal.',
    impact: 'O Cliente não fica sabendo que o navio atracou.',
  },
  {
    // Migration 304: sem contato elegível na caixa do modelo.
    type: 'nob_sem_destinatario',
    domain: 'Comunicados e e-mail',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'customer',
    severity: 'normal',
    summary: 'Um Cliente deveria receber um aviso automático (NOA, NOR, NOB ou CE e Taxas) e não tem contato válido na caixa do aviso.',
    trigger: 'O envio automático acha o Cliente sem contato ativo, com e-mail válido, na caixa Documentação e Operação (no CE e Taxas, na caixa Financeiro). Um alerta por Cliente, com os avisos pendentes.',
    timing: 'No envio automático, logo depois do fato e a cada 2 minutos, enquanto o aviso é devido. Os outros Clientes recebem normalmente.',
    resolution: 'Na ficha do Cliente, ligue um contato com e-mail válido à caixa indicada no alerta.',
    destination: '/clientes',
    destinationLabel: 'Abrir Clientes',
    afterResolution: 'Sozinho, no envio seguinte em que o Cliente tem contato válido, ou quando o aviso deixa de ser devido.',
    impact: 'Esse Cliente não recebe os avisos de chegada nem o CE e Taxas.',
  },
  {
    // Migrations 297, 303, 318 e 349 (justificativa aceita).
    type: 'comunicado_recusado',
    domain: 'Comunicados e e-mail',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'customer',
    severity: 'normal',
    summary: 'Um aviso automático ao Cliente (NOA, NOR, NOB ou CE e Taxas) não saiu.',
    trigger: 'O envio automático recusou por um dado que só uma pessoa corrige (Prontidão bloqueada, contato fora da caixa, Cliente desativado, escala ou atracação indisponível, dados incompletos), o provedor falhou três vezes seguidas ou recusou em definitivo. Um alerta por Cliente, com o motivo.',
    timing: 'Na tentativa que recusa. O Vela tenta de novo em 15 minutos, em 1 hora e depois a cada 6 horas; a recusa definitiva só volta depois de 24 horas.',
    resolution: 'Corrija o que o motivo aponta; se é falha do provedor, avise o suporte técnico.',
    destination: '/clientes/comunicacao',
    destinationLabel: 'Abrir Comunicados',
    afterResolution: 'Sozinho, quando o aviso sai ou deixa de ser devido; ou com justificativa. Resolvido com justificativa, só reabre se outro aviso do mesmo Cliente falhar.',
    impact: 'O Cliente fica sem o aviso; no CE e Taxas, sem o CE e as faturas por e-mail.',
  },
  {
    // Migration 230: CE trocado depois do Comunicado de CE e Taxas.
    type: 'comunicado_ce_reenvio_pendente',
    domain: 'Comunicados e e-mail',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'bl',
    severity: 'normal',
    summary: 'O CE Mercante de um B/L mudou, ou saiu, depois de o Cliente receber o Comunicado de CE e Taxas.',
    trigger: 'Importar, corrigir ou remover o CE de um B/L que já teve o CE e Taxas enviado. Um alerta por B/L.',
    timing: 'Na gravação do CE.',
    resolution: 'Em Clientes › Comunicação, Histórico, use Reenviar CE e Taxas no Comunicado do Cliente e da Viagem: ele sai com o CE atual.',
    destination: '/clientes/comunicacao',
    destinationLabel: 'Abrir os Comunicados do B/L',
    destinationNote: 'O alerta abre o Histórico da Comunicação já nos Comunicados de CE e Taxas do B/L.',
    afterResolution: 'Sozinho, quando o CE e Taxas é enviado de novo, depois da troca do CE.',
    impact: 'O Cliente fica com o CE errado no e-mail que recebeu.',
  },
  {
    // Migrations 309 e 319: fora a conta técnica da baixa Itaú.
    type: 'usuario_email_devolvido',
    domain: 'Comunicados e e-mail',
    responsible: 'administrativo',
    catalogAudience: ['administrativo'],
    entityType: 'user_profile',
    severity: 'normal',
    summary: 'O e-mail de uma pessoa da equipe foi devolvido ou marcado como spam: os e-mails do Vela não chegam a ela.',
    trigger: 'O e-mail de acesso de um usuário interno ativo está bloqueado. A conta técnica da baixa automática do Itaú fica de fora: não é pessoa.',
    timing: `${detectorRound}.`,
    resolution: 'Em Admin › Usuários, Editar acesso, corrija o e-mail e salve. Salvar libera o endereço antigo, se ele não for de Cliente.',
    destination: '/admin/usuarios',
    destinationLabel: 'Abrir Usuários',
    afterResolution: 'Sozinho, quando o e-mail muda, o bloqueio sai ou o usuário é desativado.',
    impact: 'Os e-mails do Vela para essa pessoa, como o Resumo do Portal, não chegam.',
  },

  // 20.8 Faturamento e Taxas Locais -----------------------------------------
  {
    // Navegador (reviewBillingAutomation) abre; servidor fecha desde a 347.
    type: 'billing_calculation_blocked',
    domain: 'Faturamento e Taxas Locais',
    responsible: 'documentacao',
    // 605 (ADR 0131, D7): avisa também o Administrativo.
    catalogAudience: ['documentacao', 'administrativo'],
    routingNote: 'Avisa também o Administrativo: ativar ou corrigir uma tabela de cobrança já usada e conceder a Liberação de faturamento são só dele.',
    entityType: 'bl',
    severity: 'critical',
    summary: 'O Vela tentou faturar um B/L e o cálculo das Taxas Locais travou.',
    trigger: 'Ao sair da Revisão ou ao ganhar o Cliente pela ficha, o cálculo do B/L travou: falta tabela de cobrança, há linha inválida ou o B/L ficou sem valor.',
    timing: 'Na hora da tentativa de faturar.',
    resolution: 'Resolver abre a tela onde se corrige. Corrija a causa que o alerta indica e recalcule em Taxas Locais.',
    destination: '/taxas-locais',
    destinationLabel: 'Abrir Taxas Locais',
    destinationNote: 'Quando o alerta indica a correção, Resolver abre direto a tela dela.',
    afterResolution: 'Sozinho, quando o cálculo fica válido ou o B/L fica isento, faturado ou cancelado.',
    impact: 'A fatura do B/L não sai: o Cliente não recebe o CE e Taxas nem consegue pagar.',
  },
  {
    // Migration 212: emissão pelo CE; fecha ao faturar ou cancelar (347).
    type: 'billing_auto_issue_failed',
    domain: 'Faturamento e Taxas Locais',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'bl',
    severity: 'critical',
    summary: 'A fatura de um B/L não saiu por uma falha técnica na emissão automática pelo CE.',
    trigger: 'A emissão automática da fatura, depois do CE Mercante, terminou com erro.',
    timing: 'Na hora da falha.',
    resolution: 'Emita a fatura em Taxas Locais › Validação. Se a falha repetir, avise o suporte técnico.',
    destination: '/taxas-locais',
    destinationLabel: 'Abrir Taxas Locais',
    afterResolution: 'Sozinho, quando a fatura sai ou o B/L é cancelado.',
    impact: 'O Cliente fica sem a fatura e sem o CE e Taxas; sem pagamento, o Desbloqueio de CE não começa.',
  },
  {
    // Migrations 204, 208 e 209: um por POD e modalidade, com a lista dos B/Ls.
    type: 'billing_charge_table_missing',
    domain: 'Faturamento e Taxas Locais',
    responsible: 'documentacao',
    // 605 (ADR 0131, D7): avisa também o Administrativo.
    catalogAudience: ['documentacao', 'administrativo'],
    routingNote: 'Avisa também o Administrativo: qualquer equipe cadastra a tabela, mas só ele a ativa ou corrige item de tabela já usada.',
    entityType: 'charge_table_gap',
    severity: 'normal',
    summary: 'B/Ls com CE esperam a fatura porque o porto de descarga e a modalidade deles não têm tabela de cobrança ativa.',
    trigger: 'A emissão pelo CE Mercante encontra B/L sem tabela de cobrança ativa para o porto de descarga e a modalidade. Um alerta por porto e modalidade, com a lista dos B/Ls.',
    timing: 'Na emissão pelo CE; cada emissão acrescenta os B/Ls que faltam.',
    resolution: 'Cadastre ou ative a tabela em Taxas Locais › Tabelas. Os B/Ls não pegam a tabela sozinhos: importe de novo a mesma planilha de CE (não gera fatura em dobro) ou recalcule-os na Validação e emita os que ficarem em Pronto para emitir.',
    destination: '/taxas-locais/tabelas',
    destinationLabel: 'Abrir tabelas de Taxas Locais',
    afterResolution: 'Sozinho: cada B/L sai da lista quando a fatura dele sai, quando é cancelado, perde o CE ou muda de porto ou de modalidade, ou quando a Viagem é cancelada. O alerta fecha com a lista vazia.',
    impact: 'Esses Clientes ficam sem fatura e sem o CE e Taxas; sem pagamento, o Desbloqueio de CE não começa.',
  },
  {
    // Migrations 124 e 128; crítico desde a 467 (reunião de testes de 2026-10-26).
    type: 'fatura_desatualizada',
    domain: 'Faturamento e Taxas Locais',
    responsible: 'administrativo',
    catalogAudience: ['administrativo', 'financeiro'],
    entityType: 'invoice',
    severity: 'critical',
    summary: 'Uma correção do B/L mudou a cobrança de uma fatura já emitida, e o Vela não conseguiu corrigir sozinho.',
    trigger: 'A fatura tem pagamento e o valor subiu, o Cliente mudou ou a correção precisa de revisão; ou a nova fatura não pôde sair.',
    timing: 'Na gravação da correção.',
    resolution: 'No detalhe da fatura, bloco Fatura desatualizada. Com pagamento: emita a Fatura Avulsa da diferença e resolva com justificativa. Com a reemissão travada: resolva o motivo e use Tentar aplicar correção.',
    destination: '/taxas-locais',
    destinationLabel: 'Abrir Taxas Locais',
    afterResolution: 'Sozinho, com a reemissão ou o cancelamento da fatura; no caso da Fatura Avulsa, com justificativa.',
    impact: 'O Cliente está com a cobrança errada até a correção.',
  },
  {
    // Migration 495: mudança de base sem o "Gravar mesmo assim".
    type: 'taxa_alterada_mudou',
    domain: 'Faturamento e Taxas Locais',
    responsible: 'administrativo',
    catalogAudience: ['administrativo', 'financeiro'],
    entityType: 'bl',
    severity: 'normal',
    summary: 'Uma mudança no B/L descartou uma taxa que alguém tinha alterado à mão, ou mudou a quantidade dela, sem passar pelo aviso Gravar mesmo assim.',
    trigger: 'Uma importação, rotina ou correção mudou o porto de descarga, a carga, um container ou um veículo de um B/L com taxa alterada à mão. Um alerta por B/L; cada mudança nova acrescenta a taxa afetada.',
    timing: 'Na hora da mudança.',
    resolution: 'Na aba Faturamento do B/L, confira a taxa e altere de novo se preciso. Depois, resolva com justificativa.',
    destination: '/bls',
    destinationLabel: 'Abrir o B/L',
    afterResolution: 'Com justificativa. Uma nova mudança que afete taxa alterada à mão abre outro.',
    impact: 'O valor combinado à mão pode ter se perdido: a fatura pode sair, ou já ter saído, diferente do combinado com o Cliente.',
  },

  // 20.9 Demurrage -------------------------------------------------------------
  {
    // Gatilhos das disputas (vez da equipe).
    type: 'portal_dispute_opened',
    domain: 'Demurrage',
    responsible: 'equipamentos',
    catalogAudience: ['equipamentos'],
    entityType: 'demurrage_invoice',
    severity: 'normal',
    summary: 'É a vez da equipe responder a uma Disputa de Demurrage.',
    trigger: 'O Cliente abriu uma Disputa no Portal, escreveu nela ou pediu a reabertura, ou a equipe a reabriu.',
    timing: 'Na hora da mensagem do Cliente.',
    resolution: 'Resolver abre a Disputa: leia a conversa e os documentos e responda ou decida.',
    destination: '/demurrage',
    destinationLabel: 'Abrir Demurrage',
    afterResolution: 'Sozinho, quando a vez passa ao Cliente, a Disputa é resolvida ou a Invoice é cancelada.',
    impact: 'A Régua de Cobrança fica pausada nessa Invoice; depois de 1 dia útil sem resposta, abre Disputa de Demurrage sem resposta no prazo.',
  },
  {
    // Migration 520 (ADR 0112, D18): 1 dia útil pelo calendário do Vela.
    type: 'demurrage_disputa_prazo',
    domain: 'Demurrage',
    responsible: 'equipamentos',
    catalogAudience: ['equipamentos'],
    entityType: 'demurrage_invoice',
    severity: 'normal',
    summary: 'Uma Disputa de Demurrage espera a resposta da equipe há mais de 1 dia útil.',
    trigger: 'A vez é da equipe e o prazo venceu: o mesmo horário do dia útil seguinte ao de quando a vez passou à equipe (sexta 17h vence segunda 17h). Um alerta por Invoice.',
    timing: `${detectorRound} depois do prazo.`,
    resolution: 'Resolver abre a conversa na aba Disputas: responda ou decida a Disputa.',
    destination: '/demurrage',
    destinationLabel: 'Abrir Disputa',
    destinationNote: 'O alerta abre a conversa da Disputa.',
    afterResolution: 'Sozinho, na hora em que a equipe responde, a Disputa é resolvida ou a Invoice é cancelada.',
    impact: 'O Cliente espera sem resposta, e a cobrança dessa Invoice continua pausada.',
  },
  {
    // Migrations 515 e 516; setor pelo motivo (ADR 0112, D25).
    type: 'demurrage_travado',
    domain: 'Demurrage',
    responsible: 'administrativo',
    responsibleDepartments: ['documentacao', 'administrativo'],
    catalogAudience: ['administrativo'],
    routingNote: 'A equipe é a do motivo: a Documentação quando falta CE ou Cliente ou o Portal segura o faturamento; o Administrativo no tipo de container sem tarifa e no B/L cancelado. Se o motivo muda, o alerta passa para a equipe do novo motivo.',
    entityType: 'bl',
    severity: 'normal',
    summary: 'Um grupo de B/Ls tem Demurrage que o Vela não tem como cobrar.',
    trigger: 'O grupo entra na divisão Travado da Demurrage: tipo de container sem tarifa, B/L sem Cliente, B/L cancelado, B/L sem CE Mercante ou Portal do Cliente segurando o faturamento. Um alerta por grupo.',
    timing: 'Na gravação que trava o grupo (datas, tipo, CE, Cliente, tarifa) e na conferência de 15 minutos.',
    resolution: 'Resolver abre a divisão Travado já buscando o B/L: use o atalho da linha (Cadastrar CE, Vincular Cliente, Cadastrar tarifa ou tipo, Abrir Cliente). Se não há o que cobrar, dispense a cobrança.',
    destination: '/demurrage',
    destinationLabel: 'Abrir Demurrage',
    destinationNote: 'O alerta abre a divisão Travado já buscando o B/L.',
    afterResolution: 'Sozinho, quando o grupo sai de Travado.',
    impact: 'A Invoice de Demurrage não sai, e a sobreestadia corre sem cobrança.',
  },
  {
    // Migration 607 (ADR 0131, D2): por atracação, Normal no ATB, Crítico em 24 horas.
    type: 'container_sem_descarga',
    domain: 'Demurrage',
    responsible: 'equipamentos',
    catalogAudience: ['equipamentos'],
    entityType: 'voyage_escala_terminal',
    severity: 'normal',
    summary: 'O navio atracou e há container dos B/Ls daquele terminal sem a data de descarga.',
    trigger: 'No ATB de cada terminal, se algum container de B/L não cancelado que descarrega ali está sem data de descarga. O container vai para o terminal da exceção do B/L ou, sem ela, para o da carga cheia da escala. Um alerta por atracação, com quantos faltam.',
    timing: 'Na hora do ATB e a cada conferência de 15 minutos. Se a descarga não entra até 24 horas depois do ATB, o alerta vira Crítico e avisa de novo.',
    resolution: 'Em Containers, use Importar datas com a planilha do terminal (B/L, container e descarga) ou grave a data no container.',
    destination: '/containers',
    destinationLabel: 'Abrir Containers',
    destinationNote: 'O alerta abre Containers já na Viagem e no porto da atracação.',
    afterResolution: 'Sozinho, na hora em que todo container do terminal tem a descarga, ou quando o B/L é cancelado ou muda de terminal, o ATB sai ou a Viagem é cancelada.',
    impact: 'Sem a descarga, o container fica para sempre no free time: a Demurrage não corre, o grupo some da página Demurrage e a sobreestadia nunca é cobrada.',
  },
  {
    // Migrations 179, 317 e 349 (decisão P1).
    type: 'demurrage_invoice_dates_changed',
    domain: 'Demurrage',
    responsible: 'administrativo',
    catalogAudience: ['administrativo'],
    entityType: 'demurrage_invoice',
    severity: 'critical',
    summary: 'As datas de um container mudaram depois de a Invoice de Demurrage ser emitida.',
    trigger: 'As datas de descarga ou devolução, o SOC/COC ou a divisão de um container entre Clientes mudaram depois da Invoice, ou o B/L dela foi cancelado. Um alerta por Invoice.',
    timing: 'Na gravação das datas.',
    resolution: 'Sem pagamento, desconto nem Disputa, o Vela já cancelou e emitiu de novo: o alerta só abre se algum container ficou sem cobrança, e diz qual; emita a Demurrage dele. Com desconto: cancele, gere de novo e refaça o desconto. Com Disputa aberta: decida a Disputa. Com pagamento: trate a diferença por restituição de Demurrage ou fatura avulsa.',
    destination: '/demurrage',
    destinationLabel: 'Abrir Demurrage',
    afterResolution: 'Sozinho, quando os containers entram numa Invoice emitida ou as datas voltam às faturadas; nos outros casos, com justificativa.',
    impact: 'Com pagamento, desconto ou Disputa, a Régua de Cobrança para nessa Invoice, e o Cliente pode estar cobrado pelo valor errado.',
  },
  {
    // Migrations 305 e 317.
    type: 'cobranca_demurrage_recusada',
    domain: 'Demurrage',
    responsible: 'administrativo',
    catalogAudience: ['administrativo'],
    entityType: 'demurrage_invoice',
    severity: 'normal',
    summary: 'A Régua de Cobrança não conseguiu mandar o e-mail de cobrança de uma Invoice de Demurrage.',
    trigger: 'O provedor de e-mail recusou o envio em definitivo, para todos os contatos ou parte deles, ou falhou três vezes seguidas. Um alerta por Invoice.',
    timing: 'Na rodada da Régua que recusa ou na terceira falha. Com recusa definitiva, a Régua pausa a Invoice; com falha passageira, continua tentando.',
    resolution: 'Leia o motivo no alerta. Recusa: corrija o e-mail do contato do Cliente e depois resolva com justificativa; a Régua volta a cobrar na rodada seguinte. Falha repetida: avise o suporte técnico.',
    destination: '/demurrage',
    destinationLabel: 'Abrir Demurrage',
    afterResolution: 'A falha repetida fecha sozinha quando a cobrança sai; a recusa, com justificativa. Os dois fecham quando a Invoice é paga, isenta ou cancelada.',
    impact: 'O Cliente não recebe a cobrança, e a Invoice pode vencer sem aviso.',
  },
  {
    // Edge recalc-demurrage-ptax e manutenção do Itaú às 14h (ALE-D11).
    type: 'demurrage_ptax_recalc_failed',
    domain: 'Demurrage',
    responsible: 'equipamentos',
    catalogAudience: ['equipamentos'],
    routingNote: 'De Equipamentos desde 2026-11-06: é quem usa Informar PTAX, junto com o Financeiro e o Administrativo.',
    entityType: 'exchange_rate_reference',
    severity: 'critical',
    summary: 'A cotação do dólar (PTAX) do dia não chegou à Demurrage. O último câmbio válido continua valendo.',
    trigger: 'A atualização das 14h, de segunda a sexta, não trouxe a PTAX do dia ou não a levou às Invoices de Demurrage. Com a cobrança pelo Itaú ligada, abre também quando a PTAX do dia não chegou aos Pix das Invoices.',
    timing: 'Na atualização das 14h que falha.',
    resolution: 'Em Demurrage, use Informar PTAX com a cotação do dia. Se repetir, avise o suporte técnico.',
    destination: '/demurrage',
    destinationLabel: 'Abrir Demurrage',
    afterResolution: 'Sozinho, na próxima atualização automática que der certo: o Informar PTAX atualiza as Invoices, mas não fecha este alerta. O dos Pix do Itaú fecha quando eles refletem a PTAX do dia, também depois do Informar PTAX.',
    impact: 'As Invoices de Demurrage em aberto ficam com o câmbio anterior: o valor em reais e o Pix não acompanham o dólar do dia.',
  },
  {
    // Manutenção do Itaú (migration 219), a partir de 1º/11.
    type: 'calendario_feriados_pendente',
    domain: 'Demurrage',
    responsible: 'administrativo',
    catalogAudience: ['administrativo'],
    routingNote: 'Avisa só a conta Dev do Administrativo, que cadastra os feriados.',
    entityType: 'business_holidays',
    severity: 'normal',
    summary: 'Os feriados de Vitória/ES do ano que vem ainda não estão cadastrados.',
    trigger: 'A partir de 1º de novembro, com a cobrança pelo Itaú ligada, se os feriados do ano seguinte não estão cadastrados.',
    timing: 'A partir de 1º de novembro, na rotina do Pix do Itaú.',
    resolution: 'A conta Dev cadastra os feriados nacionais e municipais de Vitória/ES do ano seguinte.',
    destination: '/demurrage',
    destinationLabel: 'Abrir Demurrage',
    afterResolution: 'Sozinho, quando os feriados do ano seguinte são cadastrados.',
    impact: 'No ano novo, feriado passa a contar como dia útil na Régua de Cobrança, nos prazos do Pix da Demurrage e no prazo de resposta da Disputa.',
  },

  // 20.10 Pix e pagamento ------------------------------------------------------
  {
    // Migrations 247, 153 e 587 (setor Financeiro).
    type: 'pix_unreconciled',
    domain: 'Pix e pagamento',
    responsible: 'financeiro',
    catalogAudience: ['financeiro'],
    routingNote: 'Do Financeiro: só ele, e a conta Dev do Administrativo, dá baixa e concilia o Pix.',
    entityType: 'pix_transaction',
    severity: 'critical',
    summary: 'Um Pix chegou e não pôde ser baixado sozinho com segurança.',
    trigger: 'Pix de cobrança do Vela com valor diferente da cobrança, de fatura já paga ou cancelada, ou cuja ligação com a fatura deixou de valer. O Pix do QR estático e o feito digitando a chave ficam Sem baixa, sem alerta.',
    timing: 'Na consulta do Itaú, a cada minuto, ou na importação do extrato.',
    resolution: 'Resolver abre Conciliação PIX › Pix recebidos, com o Pix no alto: dê a baixa na fatura certa ou registre a devolução.',
    destination: '/reconciliacao?tab=recebidos',
    destinationLabel: 'Abrir Conciliação PIX',
    afterResolution: 'Sozinho, quando o Pix é baixado ou tratado.',
    impact: 'O dinheiro entrou, mas a fatura continua em aberto: o Cliente pode ser cobrado de novo, e o Desbloqueio de CE não começa.',
  },
  {
    // Migrations 358 e 574 (QR estático); setor Financeiro desde a 587.
    type: 'itau_pix_consulta_parada',
    domain: 'Pix e pagamento',
    responsible: 'financeiro',
    catalogAudience: ['financeiro'],
    routingNote: 'Do Financeiro: só ele, e a conta Dev do Administrativo, concilia o Pix pelo extrato.',
    entityType: 'itau_pix_checkpoint',
    severity: 'critical',
    summary: 'A consulta dos Pix recebidos no Itaú não avança há mais de 15 minutos: os Pix pagos deixam de ser baixados sozinhos.',
    trigger: 'A conferência a cada 5 minutos acha a consulta parada há mais de 15 minutos. Vale com a cobrança pelo Itaú ligada ou desligada, porque o Pix do QR estático também dá baixa por ela.',
    timing: 'Na conferência a cada 5 minutos.',
    resolution: 'Baixe pelo Conciliar extrato, em Conciliação PIX › Pix recebidos, e avise o suporte técnico.',
    destination: '/reconciliacao?tab=recebidos',
    destinationLabel: 'Abrir Conciliação',
    afterResolution: closesOrHeld,
    impact: 'Faturas pagas continuam em aberto no Vela e no Portal, e o Desbloqueio de CE dos B/Ls delas não começa.',
  },
  {
    // Migration 130; setor Financeiro desde a 587.
    type: 'restituicao_pendente',
    domain: 'Pix e pagamento',
    responsible: 'financeiro',
    catalogAudience: ['financeiro'],
    routingNote: 'Do Financeiro: só ele, e a conta Dev do Administrativo, registra a Restituição.',
    entityType: 'invoice',
    severity: 'normal',
    summary: 'Há dinheiro a devolver ao Cliente numa fatura ou numa Invoice de Demurrage.',
    trigger: 'Qualquer restituição pendente: pagamento a mais, Pix em duplicidade, correção do B/L em fatura paga, restituição excepcional, troca de CNPJ ou cancelamento financeiro do B/L.',
    timing: 'Na gravação que cria a restituição.',
    resolution: 'Devolva o valor ao Cliente e registre a restituição como efetuada, com o comprovante, no detalhe da fatura ou da Invoice.',
    destination: '/taxas-locais',
    destinationLabel: 'Abrir Taxas Locais',
    afterResolution: 'Sozinho, quando não resta nada a devolver.',
    impact: 'O Cliente fica com dinheiro a receber da Fwlog.',
  },

  // 20.11 Desbloqueio de CE --------------------------------------------------
  {
    // Migrations 230, 238 e 325.
    type: 'ce_trocado_com_desbloqueio',
    domain: 'Desbloqueio de CE',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'bl',
    severity: 'critical',
    summary: 'O CE Mercante de um B/L cujo Desbloqueio já tinha sido conferido na ZPT foi trocado ou removido.',
    trigger: 'Troca de CE pela planilha (confirmada com motivo) ou Corrigir/Remover CE na ficha do B/L, depois do Desbloqueio conferido. Um alerta por B/L.',
    timing: 'Na gravação do CE.',
    resolution: 'Confira o Desbloqueio com o CE novo: exporte de novo para a ZPT, se preciso, e concilie.',
    destination: '/desbloqueio-ce',
    destinationLabel: 'Abrir o Desbloqueio de CE',
    afterResolution: 'Sozinho, quando a conciliação com a ZPT confirma o CE atual. Se o CE foi removido, ou a conferência foi feita fora da conciliação, com justificativa.',
    impact: 'O desbloqueio na ZPT pode ter ficado no CE antigo, e a carga do Cliente pode continuar retida.',
  },
  {
    // Migration 307: aviso esgotou as tentativas ou ficou sem destinatário.
    type: 'desbloqueio_ce_aviso_nao_enviado',
    domain: 'Desbloqueio de CE',
    responsible: 'administrativo',
    catalogAudience: ['administrativo'],
    entityType: 'customer',
    severity: 'normal',
    summary: 'O e-mail do Desbloqueio de CE ao Cliente (documento recusado ou documentação validada) não chegou a ninguém.',
    trigger: 'O aviso fechou sem destinatário (nenhum contato na caixa Documentação e Operação, ou todos bloqueados) ou com falha depois de cinco tentativas. Um alerta por Cliente.',
    timing: 'No envio dos avisos do Desbloqueio, logo depois do fato e a cada 5 minutos.',
    resolution: 'Na ficha do Cliente, ligue à caixa Documentação e Operação um contato com e-mail válido. Se o motivo for falha de envio, avise o suporte técnico. O aviso no sino do Portal já chegou ao Cliente.',
    destination: '/clientes',
    destinationLabel: 'Abrir Clientes',
    afterResolution: 'Sozinho, quando o próximo aviso ao mesmo Cliente sai; ou com justificativa.',
    impact: 'O Cliente pode não saber que um documento foi recusado ou que a documentação foi validada, e o desbloqueio atrasa.',
  },

  // 20.12 ADR de Saída -------------------------------------------------------
  {
    // Migrations 290, 323, 342 e 574 (Viagem cancelada).
    type: 'agency_report_department_pending',
    domain: 'ADR de Saída',
    responsible: 'documentacao',
    responsibleDepartments: AGENCY_REPORT_DEPARTMENTS,
    catalogAudience: ['documentacao'],
    routingNote: `Cada equipe recebe o próprio alerta, só enquanto tem seção pendente: ${agencyReportOwnershipSentence()}.`,
    entityType: 'agency_departure_report',
    severity: 'normal',
    summary: 'O navio saiu do terminal e a sua equipe ainda tem seção do ADR de Saída para conferir.',
    trigger: `A partir do ATD da atracação, enquanto a equipe tem seção Pendente no ADR. As seções são de ${agencyReportOwnershipSentence()}.`,
    timing: 'No ATD; conferido de novo a cada seção marcada.',
    resolution: 'Abra o ADR da atracação e marque cada seção da sua equipe como Confirmado ou Nada a declarar.',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens / ADR',
    afterResolution: 'Sozinho, quando a última seção da equipe sai de Pendente ou o ADR é fechado. Cancelar a Viagem fecha o alerta, e ele não abre enquanto ela estiver cancelada.',
    impact: 'O ADR de Saída não fecha; 72 horas depois do ATD, vira ADR — prazo vencido, que é crítico.',
  },
  {
    // Migration 002 (detect_agency_report_deadline_missed) e 574.
    type: 'agency_report_deadline_missed',
    domain: 'ADR de Saída',
    responsible: 'documentacao',
    responsibleDepartments: AGENCY_REPORT_DEPARTMENTS,
    catalogAudience: ['documentacao'],
    routingNote: `O prazo é cobrado por equipe: cada uma recebe o próprio alerta enquanto não assinar o ADR (${agencyReportOwnershipSentence()}).`,
    entityType: 'agency_departure_report',
    severity: 'critical',
    summary: 'Passaram 72 horas do ATD e a sua equipe ainda não assinou o ADR de Saída.',
    trigger: 'O ATD da atracação começa um prazo de 72 horas corridas (sábado, domingo e feriado contam). Vencido o prazo, cada equipe sem assinatura recebe o próprio alerta.',
    timing: `${detectorRound} depois do prazo.`,
    resolution: 'Abra o ADR, trate as seções da sua equipe e assine.',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens / ADR',
    afterResolution: 'Sozinho, quando a equipe assina ou o ADR é fechado. Cancelar a Viagem fecha o alerta, e ele não abre enquanto ela estiver cancelada.',
    impact: 'O ADR de Saída fica atrasado, sem a conferência da equipe sobre os números da escala.',
  },

  // 20.13 Rotinas paradas ----------------------------------------------------
  {
    // Migration 190: conferência de hora em hora da fila de efeitos.
    type: 'import_effects_queue_stalled',
    domain: 'Rotinas paradas',
    responsible: 'administrativo',
    catalogAudience: ['administrativo'],
    entityType: 'import_effect_queue',
    severity: 'critical',
    summary: 'Os passos que rodam depois das importações estão atrasados: há passo que devia ter rodado há mais de 60 minutos.',
    trigger: 'A conferência de hora em hora acha passo atrasado há mais de 60 minutos. Passo esperando um dado (B/L na Revisão, sem tabela de cobrança) não conta. A mensagem diz também quantos estão bloqueados.',
    timing: 'Na conferência de hora em hora.',
    resolution: 'Avise o suporte técnico. Resolva com justificativa só depois de o suporte assumir o caso.',
    destination: '/alertas',
    destinationLabel: 'Abrir Alertas',
    afterResolution: closesOrHeld,
    impact: 'As Taxas Locais, as faturas pelo CE e as Invoices de Demurrage das importações recentes não saem até a fila andar.',
  },
  {
    // Migrations 309 e 314: webhook calado (MillionSend).
    type: 'email_retorno_provedor_silencioso',
    domain: 'Rotinas paradas',
    responsible: 'administrativo',
    catalogAudience: ['administrativo'],
    entityType: 'email_provider',
    severity: 'critical',
    summary: 'O provedor de e-mail parou de dizer se os e-mails foram entregues ou devolvidos.',
    trigger: 'Pelo menos 3 e-mails aceitos pelo provedor há mais de 2 horas, nos últimos 7 dias, sem nenhum retorno (entrega, devolução ou spam) depois deles.',
    timing: `${detectorRound}.`,
    resolution: 'Avise o suporte técnico: ele confere a ligação do provedor de e-mail com o Vela.',
    destination: '/alertas',
    destinationLabel: 'Abrir Alertas',
    afterResolution: closesOrHeld,
    impact: 'O Vela não fica sabendo das devoluções: contatos errados continuam recebendo e ninguém é avisado.',
  },
  {
    // Migrations 310, 316, 533 e 534 (net._http_response; sem o nome do job).
    type: 'rotina_http_falhou',
    domain: 'Rotinas paradas',
    responsible: 'administrativo',
    catalogAudience: ['administrativo'],
    entityType: 'cron_http',
    severity: 'critical',
    summary: 'Rotinas automáticas do Vela terminaram com erro ou sem resposta na última hora.',
    trigger: 'Na última hora, duas ou mais chamadas de rotina terminaram com erro ou sem resposta, uma foi recusada por acesso, 10 esgotaram o tempo ou 30 ficaram paradas na fila. Uma falha isolada não abre.',
    timing: `${detectorRound}.`,
    resolution: 'Passe o horário do alerta ao suporte técnico. Resolva com justificativa só depois de o suporte assumir o caso.',
    destination: '/alertas',
    destinationLabel: 'Abrir Alertas',
    destinationNote: 'O alerta mostra o horário da falha, não o nome da rotina.',
    afterResolution: closesOrHeld,
    impact: 'O que a rotina faria fica parado: avisos ao Cliente, cobrança, baixa do Pix ou a própria conferência dos alertas.',
  },
  {
    // Migrations 535 e 536: aviso do provedor em investigação.
    type: 'email_retorno_nao_aplicado',
    domain: 'Rotinas paradas',
    responsible: 'administrativo',
    catalogAudience: ['administrativo'],
    entityType: 'portal_email_event',
    severity: 'normal',
    summary: 'O provedor avisou que um e-mail foi devolvido ou marcado como spam, mas o Vela não achou esse envio entre os seus.',
    trigger: 'O aviso não corresponde a nenhum envio do Vela depois de 6 tentativas (cerca de 7 horas), corresponde a mais de um envio ou falhou 6 vezes. A mesma conta do provedor envia os e-mails do site da Fwlog. O Registro mostra o destinatário mascarado.',
    timing: 'Quando o aviso esgota as tentativas.',
    resolution: 'Se o e-mail saiu de outro sistema, como o site, resolva com justificativa. Se saiu do Vela, passe o destinatário e o horário ao suporte técnico e confira o contato do Cliente.',
    destination: '/alertas',
    destinationLabel: 'Abrir Alertas',
    afterResolution: closesWithJustification,
    impact: 'Um contato do Cliente pode estar devolvendo e-mails sem que o cadastro saiba.',
  },
] satisfies AlertRuleDraft[]

function sortDepartments(departments: Iterable<AlertRuleDepartment>): AlertRuleDepartment[] {
  return DEPARTMENT_ORDER.filter((department) => new Set(departments).has(department))
}

export const ALERT_RULES: AlertRule[] = ALERT_RULES_BASE.map((rule) => {
  const responsibleDepartments = sortDepartments(rule.responsibleDepartments ?? [rule.responsible])
  return {
    ...rule,
    responsibleDepartments,
    // Espelha `fanout_alert_item_for_department` (migrations 476 e 485): o
    // setor do item e as exceções da audiência do catálogo.
    notifiedDepartments: sortDepartments([...rule.catalogAudience, ...responsibleDepartments]),
    label: TYPE_LABELS[rule.type],
  }
})

export const ALERT_RULE_DOMAINS: AlertRuleDomain[] = [
  'Viagem e datas',
  'Documentação e importação',
  'Cliente e Portal',
  'Comunicados e e-mail',
  'Faturamento e Taxas Locais',
  'Demurrage',
  'Pix e pagamento',
  'Desbloqueio de CE',
  'ADR de Saída',
  'Rotinas paradas',
]

export const ALERT_RULE_SEVERITY_LABELS: Record<AlertRuleSeverity, string> = {
  critical: 'Crítico',
  normal: 'Normal',
}

/** O que a gravidade muda, em linguagem da tela. */
export const ALERT_RULE_SEVERITY_MEANINGS: Record<AlertRuleSeverity, string> = {
  critical: 'Fica no alto da fila de Alertas, em vermelho, e conta no cartão Críticos.',
  normal: 'Entra na fila de Alertas depois dos críticos e não conta no cartão Críticos.',
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}

export function departmentNames(departments: AlertRuleDepartment[]): string {
  return joinWithAnd(departments.map((department) => ALERT_RULE_DEPARTMENT_LABELS[department]))
}

/**
 * Regra transversal do roteamento (`fanout_alert_item_for_department`,
 * migrations 338 e 476): quando ninguém ativo do setor recebe, o crítico vai
 * ao Administrativo; o normal não vai a ninguém e fica registrado em
 * Admin › Falhas de entrega de alertas.
 */
export function alertFallbackSentence(rule: Pick<AlertRule, 'notifiedDepartments'>, severity: AlertRuleSeverity): string {
  const teams = departmentNames(rule.notifiedDepartments)
  const onlyAdministrativo = rule.notifiedDepartments.length === 1 && rule.notifiedDepartments[0] === 'administrativo'
  if (severity === 'critical') {
    return onlyAdministrativo
      ? 'Se ninguém do Administrativo estiver ativo, a falha de entrega fica em Admin › Falhas de entrega de alertas.'
      : `Se ninguém de ${teams} estiver ativo, o aviso vai ao Administrativo.`
  }
  return `Se ninguém de ${teams} estiver ativo, ninguém é avisado no sino, e a falha fica em Admin › Falhas de entrega de alertas.`
}
