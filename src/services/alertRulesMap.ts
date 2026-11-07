import type { ActiveAlertType } from './alerts'
import type { AlertRuleDepartment } from './alertRulesCatalog'

// Mapa dos alertas da tela Regras de alertas (ADR 0134, decisões do dono de
// 2026-11-07): em que momento da viagem cada alerta abre, como os alertas se
// ligam, o que cada um segura do Cliente e do caixa, e os avisos que não são
// alertas mas contam a mesma história. O texto de cada regra continua em
// `alertRulesCatalog.ts`; aqui fica só o que o mapa acrescenta.
//
// As ligações foram lidas dos textos "Quando abre", "Em que momento aparece"
// e "Se ninguém agir" de cada regra e revisadas pelo dono. Ligação nova pede a
// mesma revisão: ela ensina a equipe o que acontece se ninguém agir.

/** Avisos do sino e o e-mail do ADR fechado: marcos do mapa, sem regra para trocar. */
export type AlertMapNoticeId =
  | 'aviso_solicitacao_desbloqueio'
  | 'aviso_documento_anual_vip'
  | 'aviso_novo_pagamento'
  | 'aviso_novo_pagamento_demurrage'
  | 'aviso_adr_fechado'

export type AlertMapNodeId = ActiveAlertType | AlertMapNoticeId

export type AlertMapBand = 'viagem' | 'depois' | 'sempre'

export type AlertMapStationId =
  | 'd7' | 'd5' | 'chegada' | 'atracacao' | 'saida' | 'adr'
  | 'pagamento' | 'retirada' | 'demurrage'
  | 'portal' | 'contatos' | 'bastidores'

export type AlertMapStation = {
  id: AlertMapStationId
  band: AlertMapBand
  /** O momento, como a equipe fala: D−7, ATB, Retirada. */
  when: string
  /** O assunto do momento. */
  what: string
  /** Alertas e marcos na ordem em que a equipe os encontra. */
  nodes: AlertMapNodeId[]
}

export const ALERT_MAP_BANDS: Array<{ id: AlertMapBand; title: string; note: string }> = [
  { id: 'viagem', title: 'A viagem, na ordem dos prazos', note: 'O ETA brasileiro dirige os prazos: sem ele, nenhum alerta de prazo abre.' },
  { id: 'depois', title: 'Depois da viagem', note: 'Dinheiro, retirada da carga e sobreestadia.' },
  { id: 'sempre', title: 'A qualquer momento', note: 'Cadastro, e-mail e rotinas.' },
]

export const ALERT_MAP_STATIONS: AlertMapStation[] = [
  { id: 'd7', band: 'viagem', when: 'D−7', what: 'Baplie, B/Ls e Revisão', nodes: ['voyage_baplie_missing', 'voyage_bl_expected', 'voyage_baplie_documentary_coverage', 'review_customer_unlinked', 'review_breakbulk_weight_missing', 'review_portal_not_ready', 'cliente_sem_contato_principal', 'voyage_vehicle_declaration_pending'] },
  { id: 'd5', band: 'viagem', when: 'D−5', what: 'CE Mercante e fatura', nodes: ['voyage_ce_mercante_missing', 'voyage_vehicle_sheet_pending', 'voyage_escala_terminal_missing', 'bl_sem_cliente_perto_eta', 'billing_calculation_blocked', 'billing_charge_table_missing', 'billing_auto_issue_failed', 'import_effect_blocked', 'portal_excecao_critica_fatura', 'ce_fora_do_manifesto_da_rota'] },
  { id: 'chegada', band: 'viagem', when: 'ETA e ATA', what: 'Chegada', nodes: ['voyage_schedule_date_pending', 'comunicado_noa_pendente', 'comunicado_nor_pendente'] },
  { id: 'atracacao', band: 'viagem', when: 'ATB', what: 'Atracação e descarga', nodes: ['voyage_terminal_date_pending', 'container_sem_descarga', 'comunicado_nob_pendente'] },
  { id: 'saida', band: 'viagem', when: 'ATD', what: 'Saída e exportação', nodes: ['voyage_export_after_atd', 'agency_report_department_pending'] },
  { id: 'adr', band: 'viagem', when: 'ATD + 72 h', what: 'ADR de Saída', nodes: ['agency_report_deadline_missed', 'aviso_adr_fechado'] },
  { id: 'pagamento', band: 'depois', when: 'Pagamento', what: 'Fatura e Pix', nodes: ['aviso_novo_pagamento', 'pix_unreconciled', 'restituicao_pendente', 'fatura_desatualizada', 'taxa_alterada_mudou', 'fatura_cancelada_sem_reemissao'] },
  { id: 'retirada', band: 'depois', when: 'Retirada', what: 'Desbloqueio de CE', nodes: ['aviso_solicitacao_desbloqueio', 'aviso_documento_anual_vip', 'desbloqueio_solicitacao_sem_analise', 'desbloqueio_prazo_vencendo', 'desbloqueio_divergente_zpt', 'ce_trocado_com_desbloqueio', 'desbloqueio_ce_aviso_nao_enviado'] },
  { id: 'demurrage', band: 'depois', when: 'Depois da descarga', what: 'Demurrage', nodes: ['aviso_novo_pagamento_demurrage', 'demurrage_travado', 'portal_dispute_opened', 'demurrage_disputa_prazo', 'demurrage_cancelada_sem_reemissao', 'demurrage_ptax_recalc_failed', 'demurrage_invoice_dates_changed', 'cobranca_demurrage_recusada'] },
  { id: 'portal', band: 'sempre', when: 'A qualquer momento', what: 'Portal do Cliente', nodes: ['portal_pendencia_geral', 'portal_convite_expirado', 'portal_falha_envio', 'portal_email_suprimido', 'portal_abuso_login', 'portal_reprocessamento_falhou', 'liberacao_vencendo'] },
  { id: 'contatos', band: 'sempre', when: 'A qualquer momento', what: 'Comunicados e contatos', nodes: ['cliente_contato_bounced_sem_alternativa', 'caixa_sem_destinatario', 'nob_sem_destinatario', 'comunicado_recusado', 'comunicado_ce_reenvio_pendente', 'usuario_email_devolvido'] },
  { id: 'bastidores', band: 'sempre', when: 'Bastidores', what: 'Rotinas, só a conta Dev', nodes: ['import_effects_queue_stalled', 'email_retorno_provedor_silencioso', 'rotina_http_falhou', 'rotina_interna_sem_rodar', 'email_retorno_nao_aplicado', 'itau_pix_consulta_parada', 'calendario_feriados_pendente'] },
]

/** Regras vivas que ficam fora do mapa: não abrem mais, só fecham os antigos. */
export const ALERT_MAP_OFF_MAP: ActiveAlertType[] = ['bl_vehicles_changed_on_reimport']

/** Nome curto no cartão; a ficha mostra o nome inteiro, o mesmo da fila. */
export const ALERT_MAP_SHORT_LABELS: Partial<Record<ActiveAlertType, string>> = {
  review_customer_unlinked: 'Revisão: cliente não vinculado',
  review_breakbulk_weight_missing: 'Revisão: peso BB ausente',
  review_portal_not_ready: 'Revisão: Portal não provisionado',
  portal_pendencia_geral: 'Portal: pendência geral',
  portal_convite_expirado: 'Portal: convite expirado',
  portal_falha_envio: 'Portal: falha de envio',
  portal_email_suprimido: 'Portal: e-mail suprimido',
  portal_abuso_login: 'Portal: abuso de login',
  portal_excecao_critica_fatura: 'Portal: exceção de fatura',
  portal_reprocessamento_falhou: 'Portal: falha no reprocessamento',
  demurrage_invoice_dates_changed: 'Datas mudaram em Invoice emitida',
  demurrage_cancelada_sem_reemissao: 'Invoice cancelada sem nova emissão',
  demurrage_ptax_recalc_failed: 'Falha na atualização da PTAX',
  demurrage_disputa_prazo: 'Disputa sem resposta no prazo',
  desbloqueio_ce_aviso_nao_enviado: 'Aviso do Desbloqueio não enviado',
  ce_trocado_com_desbloqueio: 'CE trocado depois do Desbloqueio',
  email_retorno_nao_aplicado: 'Retorno do provedor não aplicado',
  import_effects_queue_stalled: 'Fila de efeitos parada',
  agency_report_department_pending: 'ADR: departamento pendente',
  agency_report_deadline_missed: 'ADR: prazo vencido',
}

/**
 * Conta Dev (migrations 605, 620 e 621, ADR 0133): `only` é
 * `notify_dev_only`; `also`, `also_notify_dev`; `cause`, os tipos que
 * `_alert_item_is_technical` decide pela causa do item.
 */
export type AlertDevRouting = 'only' | 'also' | 'cause'
export const ALERT_DEV_ROUTING: Partial<Record<ActiveAlertType, AlertDevRouting>> = {
  import_effects_queue_stalled: 'only',
  email_retorno_provedor_silencioso: 'only',
  rotina_http_falhou: 'only',
  rotina_interna_sem_rodar: 'only',
  itau_pix_consulta_parada: 'only',
  email_retorno_nao_aplicado: 'only',
  calendario_feriados_pendente: 'only',
  billing_auto_issue_failed: 'also',
  portal_reprocessamento_falhou: 'also',
  import_effect_blocked: 'also',
  demurrage_ptax_recalc_failed: 'also',
  desbloqueio_ce_aviso_nao_enviado: 'cause',
  cobranca_demurrage_recusada: 'cause',
  comunicado_recusado: 'cause',
}
export const ALERT_DEV_ROUTING_LABELS: Record<AlertDevRouting, { tag: string; sentence: string }> = {
  only: { tag: 'Só Dev', sentence: 'Só a conta Dev recebe e vê na fila: é problema técnico, que só o suporte resolve.' },
  also: { tag: 'Dev', sentence: 'A equipe recebe, e a conta Dev também, para corrigir a causa técnica.' },
  cause: { tag: 'Dev pela causa', sentence: 'Depende da causa: contato ou dado, com a equipe; falha do provedor de e-mail, só a conta Dev.' },
}

/** Reforço que a própria regra traz (texto "Em que momento aparece" do catálogo). */
export const ALERT_BUILTIN_ESCALATION: Partial<Record<ActiveAlertType, string>> = {
  voyage_schedule_date_pending: 'Crítico após 16 h',
  voyage_terminal_date_pending: 'Crítico após 16 h',
  container_sem_descarga: 'Crítico após 24 h',
  desbloqueio_prazo_vencendo: 'Crítico 2 h antes',
}

export type AlertStakeId = 'ce' | 'fatura' | 'aviso' | 'portal' | 'pix' | 'desbloqueio' | 'adr' | 'demurrage' | 'alertas'
/** O que fica parado: o que importa ao Cliente e ao caixa. */
export const ALERT_STAKES: Array<{ id: AlertStakeId; label: string }> = [
  { id: 'ce', label: 'CE Mercante' },
  { id: 'fatura', label: 'Fatura de Taxas Locais' },
  { id: 'aviso', label: 'Avisos e e-mails ao Cliente' },
  { id: 'portal', label: 'Portal do Cliente' },
  { id: 'pix', label: 'Pix e baixa' },
  { id: 'desbloqueio', label: 'Desbloqueio de CE' },
  { id: 'adr', label: 'ADR de Saída' },
  { id: 'demurrage', label: 'Cobrança de Demurrage' },
  { id: 'alertas', label: 'Os próprios alertas' },
]

/** Lido do "Se ninguém agir" de cada regra. Lista vazia: afeta só a equipe. */
// A completude (todo alerta do mapa com a lista dele) é conferida no teste do mapa.
export const ALERT_STAKES_BY_TYPE: Partial<Record<ActiveAlertType, AlertStakeId[]>> = {
  voyage_escala_terminal_missing: ['aviso', 'adr'],
  voyage_schedule_date_pending: ['aviso', 'portal'],
  voyage_terminal_date_pending: ['aviso', 'adr'],
  voyage_export_after_atd: ['adr'],
  voyage_bl_expected: ['ce', 'fatura', 'aviso'],
  voyage_baplie_missing: ['ce', 'fatura'],
  voyage_baplie_documentary_coverage: ['fatura'],
  voyage_ce_mercante_missing: ['fatura', 'aviso', 'portal', 'desbloqueio'],
  voyage_vehicle_declaration_pending: ['ce'],
  voyage_vehicle_sheet_pending: ['ce', 'fatura', 'aviso', 'desbloqueio'],
  ce_fora_do_manifesto_da_rota: ['ce'],
  import_effect_blocked: ['fatura', 'demurrage'],
  review_customer_unlinked: ['fatura', 'aviso', 'portal'],
  review_breakbulk_weight_missing: ['fatura', 'aviso'],
  review_portal_not_ready: ['fatura', 'aviso', 'pix', 'desbloqueio'],
  bl_sem_cliente_perto_eta: ['aviso', 'fatura', 'portal'],
  portal_pendencia_geral: ['portal', 'fatura'],
  portal_convite_expirado: ['portal', 'fatura'],
  portal_falha_envio: ['portal', 'fatura'],
  portal_email_suprimido: ['portal'],
  portal_abuso_login: ['portal'],
  portal_excecao_critica_fatura: ['portal', 'pix'],
  liberacao_vencendo: ['fatura'],
  portal_reprocessamento_falhou: ['fatura', 'aviso'],
  cliente_contato_bounced_sem_alternativa: ['aviso', 'demurrage'],
  caixa_sem_destinatario: ['aviso'],
  cliente_sem_contato_principal: ['aviso'],
  comunicado_noa_pendente: ['aviso'],
  comunicado_nor_pendente: ['aviso'],
  comunicado_nob_pendente: ['aviso'],
  nob_sem_destinatario: ['aviso'],
  comunicado_recusado: ['aviso'],
  comunicado_ce_reenvio_pendente: ['aviso'],
  usuario_email_devolvido: [],
  billing_calculation_blocked: ['fatura', 'aviso', 'pix'],
  billing_auto_issue_failed: ['fatura', 'aviso', 'desbloqueio'],
  billing_charge_table_missing: ['fatura', 'aviso', 'desbloqueio'],
  fatura_desatualizada: ['fatura', 'pix'],
  taxa_alterada_mudou: ['fatura'],
  fatura_cancelada_sem_reemissao: ['fatura', 'pix', 'desbloqueio'],
  portal_dispute_opened: ['demurrage'],
  demurrage_disputa_prazo: ['demurrage'],
  demurrage_travado: ['demurrage'],
  container_sem_descarga: ['demurrage'],
  demurrage_invoice_dates_changed: ['demurrage'],
  cobranca_demurrage_recusada: ['demurrage', 'aviso'],
  demurrage_cancelada_sem_reemissao: ['demurrage'],
  demurrage_ptax_recalc_failed: ['demurrage', 'pix'],
  calendario_feriados_pendente: ['demurrage', 'pix', 'desbloqueio'],
  pix_unreconciled: ['pix', 'desbloqueio'],
  itau_pix_consulta_parada: ['pix', 'desbloqueio', 'portal'],
  restituicao_pendente: ['pix'],
  ce_trocado_com_desbloqueio: ['desbloqueio'],
  desbloqueio_ce_aviso_nao_enviado: ['aviso', 'desbloqueio'],
  desbloqueio_solicitacao_sem_analise: ['desbloqueio'],
  desbloqueio_prazo_vencendo: ['desbloqueio'],
  desbloqueio_divergente_zpt: ['desbloqueio'],
  agency_report_department_pending: ['adr'],
  agency_report_deadline_missed: ['adr'],
  import_effects_queue_stalled: ['fatura', 'demurrage'],
  email_retorno_provedor_silencioso: ['aviso'],
  rotina_http_falhou: ['aviso', 'demurrage', 'pix', 'alertas'],
  rotina_interna_sem_rodar: ['alertas', 'demurrage', 'aviso'],
  email_retorno_nao_aplicado: ['aviso'],
}

export type AlertMapNotice = {
  id: AlertMapNoticeId
  label: string
  channel: 'sino' | 'email'
  /** Equipes que recebem; `todos` é todo usuário interno ativo. */
  teams: AlertRuleDepartment[] | 'todos'
  summary: string
  when: string
  after: string
}

// Migration 595 (sino de acontecimentos), 614 (anual VIP) e 611 (e-mail do ADR fechado).
export const ALERT_MAP_NOTICES: Record<AlertMapNoticeId, AlertMapNotice> = {
  aviso_solicitacao_desbloqueio: {
    id: 'aviso_solicitacao_desbloqueio',
    label: 'Nova solicitação de desbloqueio de CE',
    channel: 'sino',
    teams: ['documentacao', 'administrativo'],
    summary: 'O Cliente enviou, ou reenviou, uma solicitação de desbloqueio pelo Portal.',
    when: 'Na hora do envio. A solicitação do Cliente VIP e a enviada pela equipe não avisam.',
    after: 'Sai do número do sino quando é lido.',
  },
  aviso_documento_anual_vip: {
    id: 'aviso_documento_anual_vip',
    label: 'Novo documento anual VIP',
    channel: 'sino',
    teams: ['documentacao', 'administrativo'],
    summary: 'O Cliente VIP enviou pelo Portal o termo ou a procuração anual para análise.',
    when: 'Na hora do envio. O documento enviado pela equipe não avisa.',
    after: 'Sai do número do sino quando é lido.',
  },
  aviso_novo_pagamento: {
    id: 'aviso_novo_pagamento',
    label: 'Novo pagamento',
    channel: 'sino',
    teams: ['administrativo', 'financeiro'],
    summary: 'Uma fatura de Taxas Locais foi paga.',
    when: 'Na baixa da fatura.',
    after: 'Sai do número do sino quando é lido.',
  },
  aviso_novo_pagamento_demurrage: {
    id: 'aviso_novo_pagamento_demurrage',
    label: 'Novo pagamento de Demurrage',
    channel: 'sino',
    teams: ['administrativo', 'financeiro'],
    summary: 'Uma Invoice de Demurrage foi paga.',
    when: 'Na baixa da Invoice, por Pix, extrato ou registro manual.',
    after: 'Sai do número do sino quando é lido.',
  },
  aviso_adr_fechado: {
    id: 'aviso_adr_fechado',
    label: 'ADR fechado',
    channel: 'email',
    teams: 'todos',
    summary: 'O ADR de Saída da atracação fechou. O e-mail leva o resumo e o link.',
    when: 'Quando o ADR fecha sozinho, na terceira assinatura, ou no Fechar ADR. Reabrir e fechar de novo manda outro e-mail.',
    after: 'É só e-mail: não fica no sino nem na fila.',
  },
}

export type AlertLinkKind = 'vira' | 'segura' | 'atrapalha' | 'depois' | 'mesma_causa'
export const ALERT_LINK_KINDS: Record<AlertLinkKind, { label: string; short: string }> = {
  vira: { label: 'Se ninguém agir, vira', short: 'vira' },
  segura: { label: 'Enquanto aberto, segura', short: 'segura' },
  atrapalha: { label: 'Se falhar, atrapalha sem aparecer', short: 'atrapalha' },
  depois: { label: 'Em seguida, pode abrir', short: 'depois' },
  mesma_causa: { label: 'Mesma causa', short: 'mesma causa' },
}
/** O que acontece por falta de ação: é o caminho do "E se ninguém agir?". */
export const INACTION_LINK_KINDS: ReadonlySet<AlertLinkKind> = new Set(['vira', 'segura', 'atrapalha'])

export type AlertLink = { from: AlertMapNodeId; to: AlertMapNodeId; kind: AlertLinkKind; text: string }

function link(from: AlertMapNodeId, to: AlertMapNodeId, kind: AlertLinkKind, text: string): AlertLink {
  return { from, to, kind, text }
}

export const ALERT_LINKS: AlertLink[] = [
  // D−7 e D−5: veículos, Baplie e CE.
  link('voyage_vehicle_declaration_pending', 'voyage_vehicle_sheet_pending', 'vira', 'Sem resposta até o D−5, a cobrança passa a ser a Planilha de Veículos ausente, que é crítica.'),
  link('voyage_vehicle_declaration_pending', 'voyage_ce_mercante_missing', 'segura', 'Sem a resposta sobre veículos, o CE dos B/Ls de container não vincula.'),
  link('voyage_vehicle_sheet_pending', 'voyage_ce_mercante_missing', 'segura', 'Com “terá veículos” e sem a planilha, o CE dos B/Ls de container continua travado.'),
  link('voyage_baplie_missing', 'voyage_ce_mercante_missing', 'segura', 'Sem o Baplie nem a declaração Viagem sem Baplie, o CE de B/L de container é recusado.'),
  link('voyage_baplie_missing', 'voyage_baplie_documentary_coverage', 'depois', 'Com o Baplie importado, a conferência dos containers com os B/Ls começa e pode abrir a Cobertura.'),
  link('review_customer_unlinked', 'bl_sem_cliente_perto_eta', 'vira', 'Continua aberto e, faltando 5 dias para o ETA, também abre B/L sem Cliente perto do ETA, que é crítico.'),
  link('review_customer_unlinked', 'demurrage_travado', 'segura', 'B/L sem Cliente trava a Demurrage do grupo.'),
  link('voyage_ce_mercante_missing', 'demurrage_travado', 'segura', 'B/L sem CE Mercante trava a Demurrage do grupo.'),
  link('review_portal_not_ready', 'demurrage_travado', 'segura', 'O Portal do Cliente segurando o faturamento também trava a Demurrage.'),
  link('voyage_ce_mercante_missing', 'billing_auto_issue_failed', 'depois', 'Com o CE, a fatura sai sozinha; se a emissão terminar com erro, abre a falha de emissão.'),
  link('voyage_ce_mercante_missing', 'billing_charge_table_missing', 'depois', 'Com o CE, a emissão procura a tabela de cobrança do porto e da modalidade.'),
  link('billing_charge_table_missing', 'billing_calculation_blocked', 'mesma_causa', 'Mesma causa possível, tabela de cobrança faltando: uma aparece na emissão pelo CE, a outra na saída da Revisão.'),
  link('voyage_bl_expected', 'comunicado_ce_reenvio_pendente', 'depois', 'B/L que chega depois do CE e Taxas já enviado ao Cliente abre o reenvio.'),

  // Portal do Cliente e fatura retida.
  link('portal_convite_expirado', 'review_portal_not_ready', 'segura', 'Enquanto o Cliente não ativa o Portal, a fatura continua retida.'),
  link('portal_falha_envio', 'review_portal_not_ready', 'segura', 'Sem o convite, o Portal não fica pronto e a fatura continua retida.'),
  link('portal_pendencia_geral', 'review_portal_not_ready', 'segura', 'Conta, usuário ou e-mail de recuperação faltando: o Portal não fica pronto e a fatura continua retida.'),
  link('liberacao_vencendo', 'review_portal_not_ready', 'vira', 'Vencida a Liberação sem o Portal pronto, os B/Ls voltam à Revisão e a fatura fica retida.'),
  link('review_portal_not_ready', 'portal_reprocessamento_falhou', 'depois', 'Com o Portal pronto ou a Liberação, as faturas retidas saem; se uma falhar, abre a falha no reprocessamento.'),
  link('review_portal_not_ready', 'portal_excecao_critica_fatura', 'mesma_causa', 'Mesma causa, Cliente sem Portal pronto e sem Liberação: uma segura a fatura antes; a outra avisa da fatura que saiu assim.'),

  // Chegada, atracação, saída e ADR.
  link('voyage_schedule_date_pending', 'comunicado_nor_pendente', 'segura', 'Sem o ATA, o NOR não sai para os Clientes.'),
  link('voyage_schedule_date_pending', 'voyage_terminal_date_pending', 'depois', 'Com o ATA, a cobrança passa para as datas de cada terminal: ETB, ATB, ETD e ATD.'),
  link('voyage_terminal_date_pending', 'comunicado_nob_pendente', 'segura', 'Sem o ATB, o NOB não sai.'),
  link('voyage_terminal_date_pending', 'container_sem_descarga', 'depois', 'No ATB do terminal, a conferência de descarga começa e pode abrir Container sem descarga.'),
  link('voyage_terminal_date_pending', 'agency_report_department_pending', 'segura', 'Sem o ATD, o prazo de 72 horas do ADR não começa e os alertas do ADR não abrem.'),
  link('voyage_terminal_date_pending', 'voyage_export_after_atd', 'segura', 'Sem o ATD, a cobrança da exportação também não começa.'),
  link('voyage_escala_terminal_missing', 'agency_report_department_pending', 'segura', 'Frente sem terminal deixa a carga fora do ADR e trava o Fechar ADR.'),
  link('voyage_escala_terminal_missing', 'comunicado_nob_pendente', 'segura', 'B/L sem atracação fica fora do NOB do terminal; o alerta da escala lista esses Clientes.'),
  link('voyage_export_after_atd', 'agency_report_department_pending', 'segura', 'Sem o manifesto vinculado, o ADR recusa Nada a declarar e Fechar.'),
  link('agency_report_department_pending', 'agency_report_deadline_missed', 'vira', '72 horas depois do ATD sem a assinatura, vira ADR — prazo vencido, que é crítico.'),
  link('agency_report_department_pending', 'aviso_adr_fechado', 'depois', 'Com a terceira assinatura, o ADR fecha sozinho e manda o e-mail a todos os usuários internos.'),
  link('comunicado_noa_pendente', 'comunicado_recusado', 'depois', 'Se o envio do NOA for recusado em definitivo, abre Comunicado automático recusado.'),
  link('comunicado_nor_pendente', 'comunicado_recusado', 'depois', 'Se o envio do NOR for recusado em definitivo, abre Comunicado automático recusado.'),
  link('comunicado_nob_pendente', 'comunicado_recusado', 'depois', 'Se o envio do NOB for recusado em definitivo, abre Comunicado automático recusado.'),
  link('container_sem_descarga', 'demurrage_invoice_dates_changed', 'depois', 'Se a data de descarga entra ou muda depois de a Invoice de Demurrage sair, abre Datas mudaram em Invoice emitida.'),

  // Dinheiro.
  link('aviso_novo_pagamento', 'desbloqueio_prazo_vencendo', 'depois', 'A fatura paga é um dos quatro requisitos do Desbloqueio; com os quatro, o prazo começa.'),
  link('pix_unreconciled', 'restituicao_pendente', 'depois', 'Pago a mais ou em duplicidade, o dinheiro a devolver vira Restituição pendente.'),
  link('fatura_desatualizada', 'restituicao_pendente', 'depois', 'Correção do B/L em fatura já paga pode deixar dinheiro a devolver.'),
  link('taxa_alterada_mudou', 'fatura_desatualizada', 'depois', 'Se a fatura já foi paga e a mudança sobe o valor, abre também Fatura desatualizada.'),
  link('pix_unreconciled', 'desbloqueio_prazo_vencendo', 'segura', 'Sem a baixa, as Taxas não constam pagas e o prazo do desbloqueio não começa.'),
  link('itau_pix_consulta_parada', 'desbloqueio_prazo_vencendo', 'segura', 'Com a consulta parada, faturas pagas seguem em aberto e o prazo do desbloqueio não começa.'),
  link('demurrage_cancelada_sem_reemissao', 'fatura_cancelada_sem_reemissao', 'mesma_causa', 'Mesma regra: cancelamento à mão sem nova emissão em 1 dia útil, uma na Invoice de Demurrage, a outra na fatura de Taxas Locais.'),

  // Desbloqueio de CE.
  link('aviso_solicitacao_desbloqueio', 'desbloqueio_solicitacao_sem_analise', 'vira', 'Se ninguém analisar em 2 horas úteis, abre Solicitação de desbloqueio sem análise, que é crítica.'),
  link('desbloqueio_solicitacao_sem_analise', 'desbloqueio_prazo_vencendo', 'depois', 'Termo e Procuração aprovados, com os quatro requisitos cumpridos, o prazo começa; 2 horas depois sem a ZPT, abre o Prazo vencendo.'),
  link('desbloqueio_prazo_vencendo', 'desbloqueio_divergente_zpt', 'depois', 'Exportado para a ZPT, se a conciliação volta sem Desbloqueado no CE atual, abre o B/L divergente.'),
  link('ce_trocado_com_desbloqueio', 'desbloqueio_divergente_zpt', 'vira', 'Se o desbloqueio ficou no CE antigo, a próxima conciliação traz o CE novo sem Desbloqueado e abre B/L divergente na ZPT.'),
  link('ce_trocado_com_desbloqueio', 'comunicado_ce_reenvio_pendente', 'mesma_causa', 'Mesma causa, o CE do B/L foi corrigido ou removido: uma cuida do desbloqueio na ZPT; a outra, do e-mail ao Cliente.'),

  // Contatos e e-mail.
  link('caixa_sem_destinatario', 'nob_sem_destinatario', 'segura', 'Caixa sem contato válido: o próximo aviso automático não tem a quem ir.'),
  link('caixa_sem_destinatario', 'desbloqueio_ce_aviso_nao_enviado', 'segura', 'Sem contato na caixa Documentação e Operação, o aviso do Desbloqueio fecha sem destinatário.'),
  link('cliente_contato_bounced_sem_alternativa', 'nob_sem_destinatario', 'segura', 'Sem nenhum contato válido, os próximos avisos não têm a quem ir.'),
  link('cliente_contato_bounced_sem_alternativa', 'desbloqueio_ce_aviso_nao_enviado', 'segura', 'Sem nenhum contato válido, o aviso do Desbloqueio também fica sem destinatário.'),
  link('cliente_contato_bounced_sem_alternativa', 'cobranca_demurrage_recusada', 'mesma_causa', 'Mesma causa: o e-mail do Cliente foi devolvido em definitivo.'),
  link('cliente_contato_bounced_sem_alternativa', 'comunicado_recusado', 'mesma_causa', 'Mesma causa: o e-mail do Cliente foi devolvido em definitivo.'),
  link('portal_dispute_opened', 'demurrage_disputa_prazo', 'vira', 'Um dia útil sem resposta da equipe vira Disputa sem resposta no prazo.'),

  // Bastidores: o que falha sem aparecer.
  link('email_retorno_provedor_silencioso', 'cliente_contato_bounced_sem_alternativa', 'atrapalha', 'Sem o retorno do provedor, o Vela não sabe das devoluções e este alerta não abre.'),
  link('email_retorno_provedor_silencioso', 'usuario_email_devolvido', 'atrapalha', 'Sem o retorno do provedor, a devolução do e-mail de um usuário interno passa sem aviso.'),
  link('email_retorno_nao_aplicado', 'cliente_contato_bounced_sem_alternativa', 'atrapalha', 'Uma devolução que não chegou ao cadastro pode deixar de abrir este alerta.'),
  link('rotina_interna_sem_rodar', 'voyage_ce_mercante_missing', 'atrapalha', 'Se a conferência de prazos para, os alertas de prazo, como o do D−5, deixam de abrir.'),
  link('rotina_interna_sem_rodar', 'desbloqueio_prazo_vencendo', 'atrapalha', 'Se a conferência do desbloqueio para, o prazo vence sem alerta.'),
  link('rotina_interna_sem_rodar', 'agency_report_deadline_missed', 'atrapalha', 'Se a conferência do ADR para, o prazo de 72 horas vence sem alerta.'),
  link('rotina_interna_sem_rodar', 'liberacao_vencendo', 'atrapalha', 'Se a conferência das Liberações para, a Liberação vence sem aviso.'),
  link('calendario_feriados_pendente', 'demurrage_disputa_prazo', 'atrapalha', 'Sem os feriados do ano, o prazo da Disputa conta feriado como dia útil.'),
  link('calendario_feriados_pendente', 'desbloqueio_solicitacao_sem_analise', 'atrapalha', 'Sem os feriados do ano, as 2 horas úteis da análise contam feriado como dia útil.'),
]

export function isAlertMapNotice(id: string): id is AlertMapNoticeId {
  return id in ALERT_MAP_NOTICES
}

export function stationOf(id: AlertMapNodeId): AlertMapStation | null {
  return ALERT_MAP_STATIONS.find((station) => station.nodes.includes(id)) ?? null
}

export function stakeLabel(id: AlertStakeId): string {
  return ALERT_STAKES.find((stake) => stake.id === id)?.label ?? id
}

export function stakesOf(id: AlertMapNodeId): AlertStakeId[] {
  return isAlertMapNotice(id) ? [] : ALERT_STAKES_BY_TYPE[id] ?? []
}

export type AlertNodeLinks = {
  /** Ligações que chegam ao alerta, menos a mesma causa. */
  before: AlertLink[]
  /** O que ele provoca se ninguém agir: vira, segura, atrapalha. */
  inaction: AlertLink[]
  /** O que pode abrir em seguida. */
  next: AlertLink[]
  /** Mesma causa, nos dois sentidos. */
  same: AlertLink[]
}

export function linksOf(id: AlertMapNodeId, links: AlertLink[] = ALERT_LINKS): AlertNodeLinks {
  return {
    before: links.filter((item) => item.to === id && item.kind !== 'mesma_causa'),
    inaction: links.filter((item) => item.from === id && INACTION_LINK_KINDS.has(item.kind)),
    next: links.filter((item) => item.from === id && item.kind === 'depois'),
    same: links.filter((item) => item.kind === 'mesma_causa' && (item.from === id || item.to === id)),
  }
}

/** A outra ponta da ligação, vista de `id`. */
export function otherEnd(item: AlertLink, id: AlertMapNodeId): AlertMapNodeId {
  return item.from === id ? item.to : item.from
}

export type InactionWalk = {
  start: AlertMapNodeId
  /** Passo 0 é o próprio alerta; cada passo seguinte, o que ele alcança. */
  steps: AlertMapNodeId[][]
  /** As ligações que levam a cada passo (o passo 0 não tem). */
  stepLinks: AlertLink[][]
  /** O que fica parado no fim, somando todos os alertas alcançados. */
  stakes: AlertStakeId[]
}

/**
 * "E se ninguém agir?" (ADR 0134, item 4): segue só o que acontece por falta
 * de ação (vira, segura, atrapalha), passo a passo, sem repetir alerta, e
 * termina no que fica parado.
 * ponytail: corta em 6 passos; as cadeias de hoje têm no máximo 4.
 */
export function inactionWalk(start: AlertMapNodeId, links: AlertLink[] = ALERT_LINKS): InactionWalk {
  const steps: AlertMapNodeId[][] = [[start]]
  const stepLinks: AlertLink[][] = [[]]
  const seen = new Set<AlertMapNodeId>([start])
  let frontier: AlertMapNodeId[] = [start]
  while (frontier.length && steps.length < 6) {
    const next: AlertMapNodeId[] = []
    const used: AlertLink[] = []
    for (const id of frontier) {
      for (const item of links) {
        if (item.from !== id || !INACTION_LINK_KINDS.has(item.kind)) continue
        if (!seen.has(item.to)) {
          seen.add(item.to)
          next.push(item.to)
          used.push(item)
        } else if (next.includes(item.to)) {
          used.push(item)
        }
      }
    }
    if (!next.length) break
    steps.push(next)
    stepLinks.push(used)
    frontier = next
  }
  const reached = [...seen]
  const stakes = ALERT_STAKES.map((stake) => stake.id).filter((stake) => reached.some((id) => stakesOf(id).includes(stake)))
  return { start, steps, stepLinks, stakes }
}

/**
 * Quem trava o quê (ADR 0134, revisão de 2026-11-07): o que cada coisa parada
 * é e o alerta que avisa que ela está parada. O que avisa é o sintoma; os
 * outros alertas que a seguram são as causas.
 */
export const ALERT_STAKE_INFO: Record<AlertStakeId, { what: string; warn: ActiveAlertType[] }> = {
  ce: { what: 'O número do CE Mercante de cada B/L. Sem ele, a fatura não sai, o Cliente não recebe o CE e Taxas e o Desbloqueio não começa.', warn: ['voyage_ce_mercante_missing'] },
  fatura: { what: 'A fatura de Taxas Locais do B/L. Sem ela, o Cliente não tem o que pagar e o Desbloqueio não começa.', warn: ['billing_auto_issue_failed', 'billing_calculation_blocked'] },
  aviso: { what: 'NOA, NOR, NOB, CE e Taxas, cobranças e os demais e-mails que o Vela manda ao Cliente.', warn: ['comunicado_recusado', 'nob_sem_destinatario'] },
  portal: { what: 'O acesso do Cliente ao Portal, onde ele vê B/Ls e faturas e pede o Desbloqueio.', warn: ['portal_pendencia_geral'] },
  pix: { what: 'A baixa do pagamento que o Cliente já fez: o dinheiro entrou, mas a fatura continua em aberto.', warn: ['pix_unreconciled'] },
  desbloqueio: { what: 'A liberação da carga do Cliente no terminal, depois dos quatro requisitos e da conciliação com a ZPT.', warn: ['desbloqueio_prazo_vencendo'] },
  adr: { what: 'O ADR de Saída da atracação, conferido e assinado pelas três equipes em até 72 horas do ATD.', warn: ['agency_report_deadline_missed'] },
  demurrage: { what: 'A cobrança da sobreestadia dos containers, pela Invoice de Demurrage.', warn: ['demurrage_travado'] },
  alertas: { what: 'Os próprios alertas: se a rotina que os confere para, eles deixam de abrir sem ninguém perceber.', warn: ['rotina_interna_sem_rodar'] },
}

/** O alerta é uma causa (não o aviso) do que fica parado. */
export function isStakeCause(id: AlertMapNodeId, stake: AlertStakeId): boolean {
  return stakesOf(id).includes(stake) && !(ALERT_STAKE_INFO[stake].warn as AlertMapNodeId[]).includes(id)
}

export function stakeCauses(stake: AlertStakeId): AlertMapNodeId[] {
  return ALERT_MAP_STATIONS.flatMap((station) => station.nodes).filter((id) => isStakeCause(id, stake))
}

export type AlertMapTourStep = { node: AlertMapNodeId; text: string } | { stake: AlertStakeId; text: string }
export type AlertMapTour = { id: string; title: string; sub: string; who: string; steps: AlertMapTourStep[] }

/**
 * Roteiros (ADR 0134, pedido do dono de 2026-11-07): histórias curtas sobre o
 * mapa, uma frase por passo, sem falar da conta Dev.
 */
export const ALERT_MAP_TOURS: AlertMapTour[] = [
  { id: 'veiculos', title: 'Veículos sem resposta no D−7', sub: 'A resposta de veículos trava o CE, a fatura e o Desbloqueio.', who: 'Equipamentos e Documentação', steps: [
    { node: 'voyage_vehicle_declaration_pending', text: 'D−7: Equipamentos não respondeu se a Viagem terá veículos.' },
    { node: 'voyage_ce_mercante_missing', text: 'Sem a resposta, o CE dos B/Ls de container não vincula.' },
    { node: 'voyage_vehicle_sheet_pending', text: 'D−5 sem resposta: abre Planilha de Veículos ausente, crítico.' },
    { node: 'demurrage_travado', text: 'B/L sem CE trava a Demurrage.' },
    { stake: 'desbloqueio', text: 'Sem CE, não sai fatura. Sem fatura paga, o Desbloqueio não começa.' },
  ] },
  { id: 'desbloqueio', title: 'Desbloqueio atrasado', sub: 'Onde procurar quando a carga não foi liberada.', who: 'Documentação, Financeiro e Administrativo', steps: [
    { stake: 'desbloqueio', text: 'Comece pelo que está parado: quem avisa e as causas possíveis.' },
    { node: 'review_portal_not_ready', text: 'Sem Portal pronto nem Liberação, a fatura fica retida e o Cliente não paga.' },
    { node: 'pix_unreconciled', text: 'Pix que não casou com a fatura: ela segue em aberto e o prazo não começa.' },
    { node: 'desbloqueio_solicitacao_sem_analise', text: 'A Documentação tem 2 horas úteis para analisar Termo e Procuração.' },
    { node: 'desbloqueio_prazo_vencendo', text: 'Com os quatro requisitos, o prazo começa. Só fecha com a ZPT trazendo Desbloqueado.' },
    { node: 'desbloqueio_divergente_zpt', text: 'A ZPT voltou sem Desbloqueado no CE atual: a carga continua retida.' },
  ] },
  { id: 'portal', title: 'Convite do Portal vencido', sub: 'Por que o convite segura a fatura.', who: 'Documentação e Administrativo', steps: [
    { node: 'portal_convite_expirado', text: 'O convite venceu e o Cliente não entrou no Portal.' },
    { node: 'review_portal_not_ready', text: 'Sem Portal pronto nem Liberação, a fatura fica retida na Revisão.' },
    { node: 'liberacao_vencendo', text: 'A Liberação, dada pelo Administrativo, libera a fatura. Vencida, ela volta a ficar retida.' },
    { node: 'portal_reprocessamento_falhou', text: 'Com o Portal pronto, as faturas retidas saem. Se uma falhar, abre este alerta.' },
  ] },
  { id: 'adr', title: 'Do ATA ao ADR vencido', sub: 'As datas do navio no porto e o prazo do ADR.', who: 'Operações, Documentação e Equipamentos', steps: [
    { node: 'voyage_schedule_date_pending', text: 'Dia do ETA sem ATA: o NOR não sai. Crítico após 16 horas.' },
    { node: 'voyage_terminal_date_pending', text: 'Com o ATA, faltam ETB, ATB, ETD e ATD de cada terminal. Sem ATD, o prazo do ADR não começa.' },
    { node: 'container_sem_descarga', text: 'No ATB, container sem data de descarga: a Demurrage não corre.' },
    { node: 'voyage_export_after_atd', text: 'Depois do ATD, exportação declarada sem lançamento: o ADR não fecha.' },
    { node: 'agency_report_department_pending', text: 'Cada equipe resolve e assina a sua seção do ADR.' },
    { node: 'agency_report_deadline_missed', text: '72 horas após o ATD sem assinatura: crítico.' },
  ] },
  { id: 'baplie', title: 'Baplie ausente no D−7', sub: 'Sem Baplie, o CE de container não vincula.', who: 'Documentação', steps: [
    { node: 'voyage_baplie_missing', text: 'D−7 sem Baplie importado.' },
    { node: 'voyage_ce_mercante_missing', text: 'Sem Baplie nem a declaração Viagem sem Baplie, o CE de container é recusado.' },
    { node: 'voyage_baplie_documentary_coverage', text: 'Com o Baplie importado, a conferência com os B/Ls pode abrir a Cobertura.' },
    { stake: 'ce', text: 'O CE Mercante parado: quem avisa e as causas possíveis.' },
  ] },
  { id: 'cliente', title: 'B/L sem Cliente', sub: 'B/L sem Cliente não é faturado nem avisado.', who: 'Documentação', steps: [
    { node: 'review_customer_unlinked', text: 'B/L na Revisão sem Cliente.' },
    { node: 'bl_sem_cliente_perto_eta', text: 'A 5 dias do ETA, também abre este alerta, crítico.' },
    { node: 'demurrage_travado', text: 'B/L sem Cliente trava a Demurrage.' },
  ] },
  { id: 'escala', title: 'Escala sem terminal', sub: 'Frente sem terminal fica fora do NOB e do ADR.', who: 'Operações', steps: [
    { node: 'voyage_escala_terminal_missing', text: 'D−5 da escala com frente sem terminal.' },
    { node: 'comunicado_nob_pendente', text: 'B/L sem atracação fica fora do NOB.' },
    { node: 'agency_report_department_pending', text: 'A carga fica fora do ADR e o Fechar ADR trava.' },
  ] },
  { id: 'contato', title: 'E-mail do Cliente devolvido', sub: 'Sem contato válido, os avisos não saem.', who: 'Documentação e Administrativo', steps: [
    { node: 'cliente_contato_bounced_sem_alternativa', text: 'O e-mail do Cliente foi devolvido e não há outro contato válido.' },
    { node: 'nob_sem_destinatario', text: 'Os próximos avisos automáticos não têm a quem ir.' },
    { node: 'desbloqueio_ce_aviso_nao_enviado', text: 'O aviso do Desbloqueio também fica sem destinatário.' },
    { node: 'caixa_sem_destinatario', text: 'Caixa sem contato válido tem o mesmo efeito.' },
  ] },
  { id: 'pix', title: 'Pagamento que não baixou', sub: 'Pix sem conciliação, a mais ou em fatura que mudou.', who: 'Financeiro e Administrativo', steps: [
    { node: 'pix_unreconciled', text: 'O Pix não casou sozinho com a fatura: ela segue em aberto.' },
    { node: 'desbloqueio_prazo_vencendo', text: 'Sem a baixa, o prazo do Desbloqueio não começa.' },
    { node: 'restituicao_pendente', text: 'Pago a mais ou em duplicidade: abre Restituição pendente.' },
    { node: 'fatura_desatualizada', text: 'Correção do B/L em fatura paga também pode gerar restituição.' },
  ] },
  { id: 'cancelada', title: 'Fatura cancelada sem nova', sub: 'Cancelou à mão e não emitiu de novo.', who: 'Documentação e Equipamentos', steps: [
    { node: 'fatura_cancelada_sem_reemissao', text: '1 dia útil após cancelar a fatura de Taxas Locais, o B/L segue sem fatura.' },
    { node: 'demurrage_cancelada_sem_reemissao', text: 'A mesma regra vale para a Invoice de Demurrage.' },
  ] },
  { id: 'cetrocado', title: 'CE trocado depois do Desbloqueio', sub: 'O desbloqueio pode ter ficado no CE antigo.', who: 'Documentação', steps: [
    { node: 'ce_trocado_com_desbloqueio', text: 'O CE do B/L mudou depois do Desbloqueio conferido.' },
    { node: 'desbloqueio_divergente_zpt', text: 'Se ninguém exportar de novo, a próxima conciliação traz o CE novo sem Desbloqueado.' },
    { node: 'comunicado_ce_reenvio_pendente', text: 'O Cliente recebeu o CE antigo: é preciso reenviar o CE e Taxas.' },
  ] },
  { id: 'disputa', title: 'Disputa de Demurrage', sub: 'O prazo de resposta da equipe.', who: 'Equipamentos', steps: [
    { node: 'portal_dispute_opened', text: 'O Cliente abriu uma Disputa no Portal. A cobrança dessa Invoice pausa.' },
    { node: 'demurrage_disputa_prazo', text: '1 dia útil sem resposta da equipe: abre este alerta.' },
  ] },
]
