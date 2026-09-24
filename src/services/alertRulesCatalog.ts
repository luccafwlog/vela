import { AGENCY_REPORT_SECTIONS, AGENCY_REPORT_SECTION_LABELS, type AgencyReportSection } from './agencyDepartureReport'
import { ENTITY_TYPE_LABELS, TYPE_LABELS, type ActiveAlertType } from './alerts'

export type AlertRuleDomain = 'Operação' | 'Revisão' | 'Financeiro' | 'Portal'
export type AlertRuleDepartment = 'documentacao' | 'equipamentos' | 'operacoes' | 'administrativo'
export type AlertRuleSeverity = 'critical' | 'normal'

// O manual só documenta regras vivas: um tipo sem produtor sai desta lista na
// mesma mudança que o aposenta no catálogo SQL, para a tela não prometer um
// alerta que nunca chega. O histórico da aposentadoria fica no CHANGELOG e nas
// migrations que a executaram.

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
   * Espelha `alert_type_catalog.audience_departments` (migrations 317/325).
   * É a audiência fixa da notificação interna, independente do responsável.
   */
  catalogAudience: AlertRuleDepartment[]
  /**
   * Derivado: quem recebe a notificação interna. A função SQL
   * `fanout_alert_item_for_department` une a audiência do catálogo ao
   * departamento gravado no item.
   */
  notifiedDepartments: AlertRuleDepartment[]
  routingNote?: string
  entityType: keyof typeof ENTITY_TYPE_LABELS
  severity: AlertRuleSeverity
  summary: string
  trigger: string
  timing: string
  resolution: string
  destination: string
  destinationLabel: string
  destinationNote?: string
  afterResolution: string
  dismissal: string
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
const DEPARTMENT_ORDER: AlertRuleDepartment[] = [...ALERT_RULE_DEPARTMENTS, 'administrativo']

export const ALERT_RULE_DEPARTMENT_LABELS: Record<AlertRuleDepartment, string> = {
  documentacao: 'Documentação',
  equipamentos: 'Equipamentos',
  operacoes: 'Operações',
  administrativo: 'Administrativo',
}

const temporaryDismissal = 'Pode ser dispensado temporariamente na fila, com motivo obrigatório e data futura de revisão. A dispensa não corrige a origem nem libera um bloqueio.'
const derivedResolution = 'O alerta é fechado automaticamente quando a origem é corrigida e a reconciliação confirma que a pendência deixou de existir.'

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
  {
    type: 'review_customer_unlinked',
    domain: 'Revisão',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'bl',
    severity: 'critical',
    summary: 'O B/L está aguardando revisão, mas ainda não foi vinculado a um cliente.',
    trigger: 'B/L com status de revisão pendente e sem cliente associado.',
    timing: 'Aparece imediatamente enquanto a revisão permanecer pendente.',
    resolution: 'Vincule o B/L ao cliente correto na fila de Revisão.',
    destination: '/revisao',
    destinationLabel: 'Abrir Revisão',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'review_customer_email_missing',
    domain: 'Revisão',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'bl',
    severity: 'critical',
    summary: 'O B/L tem cliente, mas o cadastro não possui um e-mail de contato utilizável.',
    trigger: 'Cliente vinculado ao B/L sem contato com e-mail preenchido.',
    timing: 'Aparece durante a revisão pendente e some quando um e-mail válido é cadastrado.',
    resolution: 'Cadastre ou corrija o contato do cliente e conclua a revisão do B/L.',
    destination: '/revisao',
    destinationLabel: 'Abrir Revisão',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'review_portal_not_ready',
    domain: 'Revisão',
    responsible: 'documentacao',
    catalogAudience: ['documentacao', 'administrativo'],
    entityType: 'bl',
    severity: 'critical',
    summary: 'O cliente do B/L ainda não tem uma conta de Portal pronta para uso, e o faturamento dele está retido.',
    trigger: 'Cliente sem conta ativa do Portal e sem Liberação de faturamento vigente, com B/L em revisão ou fatura retida pelo CE.',
    timing: 'Aparece durante a revisão pendente ou na retenção da fatura; some quando o Portal fica pronto ou o Administrativo concede a Liberação.',
    resolution: 'Abra a gestão do Portal e regularize a conta; se o Cliente precisar faturar antes, o Administrativo concede a Liberação de faturamento sem Portal.',
    destination: '/clientes/portal',
    destinationLabel: 'Abrir Clientes e Portal',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'review_breakbulk_weight_missing',
    domain: 'Revisão',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'bl',
    severity: 'critical',
    summary: 'Um B/L de carga solta está sem peso informado para seguir na revisão.',
    trigger: 'B/L de carga solta com peso ausente ou menor que o valor mínimo aceito.',
    timing: 'Aparece enquanto o B/L permanecer em revisão pendente.',
    resolution: 'Informe o peso correto da carga solta e confirme a revisão.',
    destination: '/revisao',
    destinationLabel: 'Abrir Revisão',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'review_granite_customer_unlinked',
    domain: 'Revisão',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'granite_bl',
    // Normal desde a migration 078: Granito é apoio operacional e não fatura.
    severity: 'normal',
    summary: 'O B/L de Granito foi recebido sem cliente vinculado.',
    trigger: 'Registro de Granito sem cliente associado.',
    timing: 'Aparece assim que o registro é criado ou alterado sem vínculo.',
    resolution: 'Associe o registro de Granito ao cliente correto na revisão.',
    destination: '/revisao',
    destinationLabel: 'Abrir Revisão',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'billing_calculation_blocked',
    domain: 'Financeiro',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'bl',
    severity: 'critical',
    summary: 'O cálculo das Taxas Locais de um B/L não conseguiu avançar.',
    trigger: 'O motor de cobrança encontra uma pendência que impede o cálculo.',
    timing: 'Aparece no momento do cálculo e permanece até a causa ser corrigida.',
    resolution: 'Siga a correção indicada no alerta e revise o cálculo na operação de Taxas Locais.',
    destination: '/taxas-locais',
    destinationLabel: 'Abrir Taxas Locais',
    destinationNote: 'Quando o alerta traz uma rota de correção própria, ele abre direto a tela indicada no lugar da lista de Taxas Locais.',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'billing_auto_issue_failed',
    domain: 'Financeiro',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'bl',
    severity: 'critical',
    summary: 'A emissão automática de uma cobrança falhou e precisa de conferência.',
    trigger: 'Uma tentativa automática de emitir o documento financeiro termina com erro.',
    timing: 'Aparece após a falha da emissão automática.',
    resolution: 'Abra a operação de Taxas Locais, corrija a pendência e faça a emissão controlada.',
    destination: '/taxas-locais',
    destinationLabel: 'Abrir Taxas Locais',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'demurrage_ptax_recalc_failed',
    domain: 'Financeiro',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'exchange_rate_reference',
    severity: 'critical',
    summary: 'A atualização automática da PTAX da Demurrage falhou e o último valor válido foi preservado.',
    trigger: 'O job protegido não consegue obter uma cotação válida, salvar a referência cambial ou concluir o recálculo das invoices abertas.',
    timing: 'Aparece na primeira falha do job e permanece até uma execução completa confirmar a recuperação.',
    resolution: 'Abra Demurrage, confira a disponibilidade da PTAX e trate a causa técnica antes de repetir o recálculo autorizado.',
    destination: '/demurrage',
    destinationLabel: 'Abrir Demurrage',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'import_effect_blocked',
    domain: 'Financeiro',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'import_effect',
    severity: 'critical',
    summary: 'Um efeito pós-commit de importação foi bloqueado e precisa de investigação.',
    trigger: 'O worker esgota as tentativas transitórias ou encontra um payload, domínio ou consumidor não suportado.',
    timing: 'Aparece quando o efeito entra em blocked e permanece até o operador revisar e reabrir a fila com justificativa.',
    resolution: 'Abra Alertas, investigue o efeito e use a ação de retry somente depois de corrigir a causa.',
    destination: '/alertas',
    destinationLabel: 'Abrir Alertas',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'pix_unreconciled',
    domain: 'Financeiro',
    responsible: 'administrativo',
    catalogAudience: ['administrativo', 'documentacao', 'equipamentos'],
    routingNote: 'Administrativo trata na fila, porque só ele abre a Conciliação PIX; Documentação e Equipamentos também recebem a notificação interna, porque o PIX pode se referir a uma invoice de Demurrage.',
    entityType: 'pix_transaction',
    severity: 'critical',
    summary: 'Um PIX não encontrou uma correspondência segura com a cobrança esperada.',
    trigger: 'A transação não pode ser associada automaticamente a um recebível confiável, ou a associação anterior foi invalidada.',
    timing: 'Aparece após a importação ou tentativa de conciliação do PIX.',
    resolution: 'Investigue a transação e confirme a correspondência na Conciliação PIX.',
    destination: '/reconciliacao',
    destinationLabel: 'Abrir Conciliação PIX',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'portal_dispute_opened',
    domain: 'Portal',
    responsible: 'equipamentos',
    catalogAudience: ['equipamentos'],
    entityType: 'demurrage_invoice',
    severity: 'normal',
    summary: 'Um cliente abriu uma disputa sobre uma invoice de Demurrage.',
    trigger: 'A conversa de disputa fica aberta com a próxima resposta atribuída a Equipamentos.',
    timing: 'Aparece enquanto a disputa estiver aberta aguardando resposta interna; some quando a bola volta para o cliente ou a disputa é resolvida.',
    resolution: 'Leia a conversa, analise os documentos e responda ou resolva a disputa em Demurrage.',
    destination: '/demurrage',
    destinationLabel: 'Abrir Demurrage',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'portal_pendencia_geral',
    domain: 'Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'customer',
    severity: 'normal',
    summary: 'Existe um processo ativo, mas o Portal do cliente não está plenamente utilizável.',
    trigger: 'Cliente com B/L ativo sem Portal ativo, sem usuário provisionado ou sem e-mail de recuperação válido.',
    timing: 'É reavaliado pelo reconciliador do Portal enquanto houver processo ativo.',
    resolution: 'Regularize a conta e o e-mail de recuperação do cliente na gestão do Portal.',
    destination: '/clientes/portal',
    destinationLabel: 'Abrir Clientes e Portal',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'portal_convite_expirado',
    domain: 'Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'customer',
    severity: 'normal',
    summary: 'O convite do Portal do cliente expirou antes da ativação.',
    trigger: 'A conta do cliente permanece com situação de convite expirado.',
    timing: 'Aparece durante processo ativo até que o convite seja renovado ou a conta regularizada.',
    resolution: 'Abra o cliente, confirme os dados e reenvie o convite do Portal.',
    destination: '/clientes/portal',
    destinationLabel: 'Abrir Clientes e Portal',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'portal_falha_envio',
    domain: 'Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'customer',
    severity: 'normal',
    summary: 'O envio do convite do Portal falhou.',
    trigger: 'A conta do cliente fica com situação de falha no envio.',
    timing: 'Aparece enquanto o processo estiver ativo e o convite não for reenviado com sucesso.',
    resolution: 'Revise o e-mail do cliente e reenvie o convite pela gestão do Portal.',
    destination: '/clientes/portal',
    destinationLabel: 'Abrir Clientes e Portal',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'portal_email_suprimido',
    domain: 'Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'customer',
    severity: 'normal',
    summary: 'O e-mail de recuperação está suprimido ou não pode ser usado.',
    trigger: 'O e-mail tem status diferente de utilizável ou aparece na lista de endereços suprimidos.',
    timing: 'Aparece enquanto houver processo ativo e o endereço continuar bloqueado.',
    resolution: 'Escolha e confirme um endereço de recuperação utilizável na gestão do Portal.',
    destination: '/clientes/portal',
    destinationLabel: 'Abrir Clientes e Portal',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'portal_abuso_login',
    domain: 'Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'customer',
    severity: 'critical',
    summary: 'O padrão de tentativas de login exige investigação de segurança.',
    trigger: 'O sistema registra evidências de abuso ou tentativas anormais de acesso no Portal.',
    timing: 'Aparece quando o evento de segurança é registrado.',
    resolution: 'Investigue as evidências, proteja a conta e registre a tratativa de segurança.',
    destination: '/clientes/portal',
    destinationLabel: 'Abrir Clientes e Portal',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'cliente_contato_bounced_sem_alternativa',
    domain: 'Portal',
    responsible: 'documentacao',
    responsibleDepartments: ['documentacao', 'administrativo'],
    catalogAudience: ['documentacao', 'administrativo'],
    entityType: 'customer',
    severity: 'critical',
    summary: 'O cliente perdeu todos os contatos válidos após bounce permanente e não possui endereço alternativo.',
    trigger: 'Webhook de e-mail detecta bounce permanente e nenhum outro contato válido resta no cadastro.',
    timing: 'Aparece no momento do bounce e permanece até que um novo contato com e-mail válido seja cadastrado.',
    resolution: 'Abra o cadastro do cliente na aba Contatos e cadastre um endereço de e-mail válido.',
    destination: '/clientes',
    destinationLabel: 'Abrir Clientes',
    destinationNote: 'Quando o cliente estiver identificado, o alerta abre diretamente `/clientes/{cnpj}?tab=contatos`.',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'portal_excecao_critica_fatura',
    domain: 'Portal',
    responsible: 'documentacao',
    responsibleDepartments: ['documentacao', 'administrativo'],
    catalogAudience: ['documentacao', 'administrativo'],
    entityType: 'bl',
    severity: 'critical',
    summary: 'Uma invoice foi emitida sem que o Portal do cliente estivesse apto a recebê-la.',
    trigger: 'Invoice emitida para B/L cujo gate do Portal não está permitido.',
    timing: 'Aparece na emissão e permanece até a fatura sair do estado que mantém a exceção.',
    resolution: 'Abra o B/L na aba Financeiro, regularize o gate do Portal e trate a fatura.',
    destination: '/bls',
    destinationLabel: 'Abrir B/Ls',
    destinationNote: 'Quando o B/L estiver identificado, o alerta abre diretamente `/bls/{id}?tab=faturamento`; este link leva à lista para localizar o B/L afetado.',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'portal_reprocessamento_falhou',
    domain: 'Portal',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'bl',
    severity: 'critical',
    summary: 'O faturamento de um B/L falhou ao ser reprocessado depois da ativação do Portal.',
    trigger: 'O reprocessamento pós-ativação termina com falha técnica não recuperada.',
    timing: 'Aparece durante o reprocessamento automático após a ativação do Portal.',
    resolution: 'Abra o B/L na aba Financeiro, analise o erro e faça a correção financeira necessária.',
    destination: '/bls',
    destinationLabel: 'Abrir B/Ls',
    destinationNote: 'Quando o B/L estiver identificado, o alerta abre diretamente `/bls/{id}?tab=faturamento`; este link leva à lista para localizar o B/L afetado.',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'voyage_bl_expected',
    domain: 'Operação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage',
    severity: 'critical',
    summary: 'A viagem chegou à janela de conferência e ainda faltam B/Ls esperados.',
    trigger: 'Atinge D-7 do primeiro ETA brasileiro e as rotas esperadas não estão cobertas por B/Ls.',
    timing: 'Começa em D-7 do primeiro ETA brasileiro elegível e é recalculado até a cobertura completa.',
    resolution: 'Confira a viagem e importe ou corrija os B/Ls que faltam nas rotas esperadas.',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'voyage_baplie_missing',
    domain: 'Operação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage',
    severity: 'critical',
    summary: 'A viagem entrou na janela de conferência sem nenhum Baplie registrado.',
    trigger: 'Atinge D-7 do primeiro ETA brasileiro e não há containers Baplie para a viagem.',
    timing: 'Começa em D-7 e desaparece quando um Baplie é importado.',
    resolution: 'Importe o arquivo Baplie correto e revise o resultado da importação.',
    destination: '/baplie',
    destinationLabel: 'Abrir Baplie EDI',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'voyage_baplie_documentary_coverage',
    domain: 'Operação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage',
    severity: 'critical',
    summary: 'Há divergência documental entre o Baplie e os B/Ls da viagem.',
    trigger: 'Depois da janela de cobertura, rotas ou containers do Baplie não correspondem aos B/Ls.',
    timing: 'Divergências de rota só passam a alertar em D-7; divergências encontradas depois são reconciliadas continuamente.',
    resolution: 'Abra o Baplie, compare os containers e corrija o documento ou o B/L na origem correta.',
    destination: '/baplie',
    destinationLabel: 'Abrir Baplie EDI',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'voyage_ce_mercante_missing',
    domain: 'Operação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage',
    severity: 'critical',
    summary: 'Existem B/Ls da viagem sem CE Mercante informado.',
    trigger: 'Atinge D-5 do primeiro ETA brasileiro e pelo menos um B/L continua sem CE Mercante.',
    timing: 'Começa em D-5 e é recalculado conforme os CEs são preenchidos.',
    resolution: 'Abra a viagem, identifique os B/Ls afetados e informe os CEs Mercante corretos.',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'voyage_schedule_date_pending',
    domain: 'Operação',
    responsible: 'operacoes',
    catalogAudience: ['operacoes', 'documentacao'],
    routingNote: 'Operações é o setor responsável na fila; Documentação também recebe a notificação interna, porque a audiência do tipo no catálogo SQL inclui os dois setores.',
    entityType: 'voyage_pod_schedule',
    severity: 'normal',
    summary: 'Uma escala ainda não tem a data compartilhada que o ciclo operacional espera.',
    trigger: 'A escala atingiu o ETA sem ATA informada; ou já tem ATA e nenhuma atracação da escala tem ETB previsto.',
    timing: 'Cobra a ATA a partir do dia do ETA (fuso de São Paulo) e o ETB assim que a ATA é informada. É recalculado a cada mudança de rota, de datas da escala ou das atracações.',
    resolution: 'Abra a viagem e informe a ATA da escala, ou crie/complete a atracação com o ETB previsto. ETD, ATB e ATD são datas do terminal — veja a regra de datas do terminal.',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'voyage_terminal_date_pending',
    domain: 'Operação',
    responsible: 'operacoes',
    catalogAudience: ['operacoes', 'documentacao'],
    routingNote: 'Operações é o setor responsável na fila; Documentação também recebe a notificação interna, porque a audiência do tipo no catálogo SQL inclui os dois setores.',
    entityType: 'voyage_escala_terminal',
    severity: 'normal',
    summary: 'Uma atracação ainda não tem as datas próprias do terminal completas.',
    trigger: 'A atracação atingiu o ETB sem ATB; ou tem ATB e ainda não tem ETD previsto; ou atingiu o ETD sem ATD.',
    timing: 'Cada etapa entra quando a data prevista é atingida (ATB após o ETB, ATD após o ETD) ou assim que a anterior é informada (ETD logo após a ATB). Cada terminal da escala tem a própria cadeia.',
    resolution: 'Abra a viagem, selecione a atracação e informe a data cobrada (ATB, ETD do terminal ou ATD).',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'voyage_export_after_atd',
    domain: 'Operação',
    responsible: 'operacoes',
    catalogAudience: ['operacoes'],
    entityType: 'voyage_pod_schedule',
    severity: 'normal',
    summary: 'A escala já passou pelo ATD de um terminal, mas o planejamento de exportação continua sem vínculo.',
    trigger: 'A escala tem exportação planejada, um terminal já registrou ATD e o manifesto de Granito e/ou de Vazios previsto ainda não está vinculado à viagem.',
    timing: 'Começa após o ATD do terminal e permanece até os manifestos previstos serem vinculados ou o planejamento ser corrigido.',
    resolution: 'Abra a viagem e vincule os manifestos de Granito/Vazios da exportação, ou corrija o planejamento de exportação da escala.',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'comunicado_noa_pendente',
    domain: 'Operação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage_pod_schedule',
    severity: 'normal',
    summary: 'Uma escala entrou na janela do NOA e ainda não recebeu o aviso ao cliente.',
    trigger: 'O ETA da escala está entre cinco dias antes e o instante anterior à chegada, sem NOA enviado para a escala.',
    timing: 'Começa cinco dias antes do ETA e é reavaliado pelo runner de alertas até o ETA passar ou o NOA ser enviado.',
    resolution: 'Abra Comunicados, confira os B/Ls e os contatos elegíveis e envie o NOA ao cliente correto.',
    destination: '/clientes/comunicacao',
    destinationLabel: 'Abrir Comunicados',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'comunicado_nor_pendente',
    domain: 'Operação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage_pod_schedule',
    severity: 'normal',
    summary: 'Uma escala tem ATA recente e ainda não recebeu o aviso de prontidão ao cliente.',
    trigger: 'A ATA da escala foi informada nos últimos trinta dias, sem NOR enviado para a escala.',
    timing: 'Começa quando a ATA entra e permanece por trinta dias, ou até o NOR ser enviado.',
    resolution: 'Abra Comunicados, confira os B/Ls e os contatos elegíveis e envie o NOR ao cliente correto.',
    destination: '/clientes/comunicacao',
    destinationLabel: 'Abrir Comunicados',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'comunicado_nob_pendente',
    domain: 'Operação',
    responsible: 'documentacao',
    catalogAudience: ['documentacao'],
    entityType: 'voyage_escala_terminal',
    severity: 'normal',
    summary: 'Uma atracação tem ATB recente e ainda não recebeu o aviso de atracação ao cliente.',
    trigger: 'O ATB da atracação foi informado nos últimos trinta dias, sem NOB enviado para aquela atracação.',
    timing: 'Começa quando o ATB entra e permanece por trinta dias, ou até o NOB ser enviado.',
    resolution: 'Abra Comunicados, confira os B/Ls daquele terminal e envie o NOB ao cliente correto.',
    destination: '/clientes/comunicacao',
    destinationLabel: 'Abrir Comunicados',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'agency_report_department_pending',
    domain: 'Operação',
    responsible: 'documentacao',
    responsibleDepartments: AGENCY_REPORT_DEPARTMENTS,
    catalogAudience: ['documentacao'],
    routingNote: `O detector abre um item por departamento com seção pendente, e cada setor trata o próprio item: ${agencyReportOwnershipSentence()}. Documentação também é notificada dos itens de Operações e Equipamentos, porque a audiência fixa do tipo no catálogo SQL é Documentação.`,
    entityType: 'agency_departure_report',
    severity: 'normal',
    summary: 'Uma seção do ADR ainda aguarda a decisão do departamento responsável.',
    trigger: `Depois do ATD do terminal, alguma seção do ADR continua sem Confirmado nem Nada a declarar. As seções pertencem a ${agencyReportOwnershipSentence()}.`,
    timing: 'Passa a valer após o ATD da atracação e é reavaliado a cada sign-off; cada departamento só recebe o item enquanto tiver seção pendente.',
    resolution: 'Abra o ADR da atracação, revise as seções do seu departamento e marque Confirmado ou Nada a declarar.',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens / ADR',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
  },
  {
    type: 'agency_report_deadline_missed',
    domain: 'Operação',
    responsible: 'documentacao',
    responsibleDepartments: AGENCY_REPORT_DEPARTMENTS,
    catalogAudience: ['documentacao'],
    routingNote: `O prazo é cobrado por departamento: cada setor recebe o próprio alerta enquanto não registrar o sign-off do ADR (${agencyReportOwnershipSentence()}). Documentação também é notificada dos itens de Operações e Equipamentos, porque a audiência fixa do tipo no catálogo SQL é Documentação.`,
    entityType: 'agency_departure_report',
    severity: 'critical',
    summary: 'O prazo de conclusão do ADR venceu com um departamento ainda sem sign-off.',
    trigger: 'O ATD da atracação inicia um prazo de 3 dias úteis; passada a data-limite, cada departamento sem sign-off do ADR recebe o próprio alerta.',
    timing: 'Começa no dia seguinte ao vencimento do prazo calculado a partir do ATD e some quando o departamento assina.',
    resolution: 'Abra o ADR, trate as seções pendentes do seu departamento e registre o sign-off.',
    destination: '/viagens',
    destinationLabel: 'Abrir Viagens / ADR',
    afterResolution: derivedResolution,
    dismissal: temporaryDismissal,
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
    // Espelha `fanout_alert_item_for_department`: audiência do catálogo unida
    // ao departamento gravado no item.
    notifiedDepartments: sortDepartments([...rule.catalogAudience, ...responsibleDepartments]),
    label: TYPE_LABELS[rule.type],
    // Mantém o rótulo técnico em um único lugar e permite que a busca encontre
    // tanto o nome humano quanto a descrição educativa.
    summary: `${TYPE_LABELS[rule.type]}: ${rule.summary}`,
  }
})

export const ALERT_RULE_DOMAINS: AlertRuleDomain[] = ['Operação', 'Revisão', 'Financeiro', 'Portal']

export const ALERT_RULE_SEVERITY_LABELS: Record<AlertRuleSeverity, string> = {
  critical: 'Crítico',
  normal: 'Normal',
}

export const ALERT_RULE_DOMAIN_DESCRIPTIONS: Record<AlertRuleDomain, string> = {
  Operação: 'Viagens, escalas, terminais e ADRs.',
  Revisão: 'Pendências que impedem a revisão de documentos e cadastros.',
  Financeiro: 'Cobranças, pagamentos e conciliação.',
  Portal: 'Eventos do Portal tratados pela equipe interna.',
}

// Regra transversal do roteamento: quando nenhum usuário ativo pertence à
// audiência de um item crítico, a notificação é redirecionada para
// Administrativo/Admin (`fanout_alert_item_for_department`, migration 338).
export const ALERT_CRITICAL_FALLBACK_NOTE = 'Se nenhum usuário ativo pertencer aos setores notificados, um alerta crítico é redirecionado para Administrativo/Admin; a falha de entrega só é registrada para auditoria quando nem esse redirecionamento encontra destinatário ativo.'
