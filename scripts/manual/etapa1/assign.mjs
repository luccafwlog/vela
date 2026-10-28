import fs from 'node:fs'
const S = process.argv[2]
const items = JSON.parse(fs.readFileSync(`${S}/inventario.json`, 'utf8'))
// Ordem importa: a primeira área que casa leva o item.
const AREAS = [
  ['08-desbloqueio-ce', /ce_unlock|ce-unlock|ceUnlock|desbloqueio|zpt|unlock|^(command|actor|vip_json|request_json)$/i],
  ['12-alertas-rotinas', /alert|internal_notification|notificacao_interna|http_job|http-job|data_retention|data-retention|queue_health|queue-health|edge_job|cron|heartbeat|runner_lease|job_failure/i],
  ['11-demurrage', /demurrage|dunning|ptax|dispute|free_?time|container_demurrage/i],
  ['10-recebimento', /pix|itau|payment|pagamento|ledger|settlement|refund|restitu|baixa|reconcil.*(pix|extrato)|statement|financial_payment/i],
  ['07-portal', /portal|invite|convite|password|senha|login|recovery|inspection|inspecao|provision|turnstile|digest|rate_limit|suppressed_email|email_event/i],
  ['09-taxas-faturamento', /charge|invoice|billing|fatur|tarif|rate_override|pricing|cod_adjust|exchange_rate|(^|_)roe(_|\b)|receivable|price_freeze|avulsa|consolidat|cambio|issue_|emit/i],
  ['06-clientes-comunicacao', /customer|cliente|communication|comunicad|contact|contato|information|informacao|carrier_portal|depot_portal|port_agent|suppression|box_kind|cnpj/i],
  ['04-ce-baplie', /ce_mercante|ce_master|mercante|manifesto|baplie|documental|route_ce/i],
  ['05-equipamentos', /container|vehicle|veicul|vazio|depot|granit|granite|unpack|desova|(^|_)teu|(^|_)(soc|coc)(_|\b)/i],
  ['02-viagens-adr', /voyage|viagem|escala|vessel|navio|carrier|(^|_)ports?(_|\b)|port_code|berth|atraca|omission|omiss|transship|transbord|change_of_destination|(^|_)cod(_|\b)|agency_report|agency_departure|(^|_)adr(_|\b)|ended_vessel|holiday|feriado|lineup|line_up|schedule|programac|chegadas|terminal|operation_front/i],
  ['03-bl-revisao', /\bbls?\b|bls\.|bl_|_bl|freight|breakbulk|review|revis|import_batch|import_error|import_effect|import_pending|reconciliation_queue|manifest/i],
  ['01-acesso-admin', /user|usuario|admin|audit|delete|exclu|trava|lock|credential|permission|setor|department|report|relatorio|export|operational_event|app_settings|record|reactivat|cancel/i],
]
const keyOf = (item) => {
  if (item.kind === 'mensagem') return `${item.detail}`
  if (item.kind === 'funcao') return `${item.name} ${item.detail}`
  return `${item.name} ${item.detail ?? ''}`
}
const result = {}
for (const item of items) {
  let area = '00-transversal'
  if (item.kind === 'alerta') area = '12-alertas-rotinas'
  else if (item.kind === 'permissao') area = '01-acesso-admin'
  else if (item.kind === 'mensagem') {
    // pela primeira função que contém a mensagem
    const fns = item.detail.replace(/^em /, '').split(', ')
    for (const fn of fns) { const hit = AREAS.find(([, re]) => re.test(fn)); if (hit) { area = hit[0]; break } }
  } else {
    const key = item.kind === 'funcao' ? item.name : keyOf(item)
    const hit = AREAS.find(([, re]) => re.test(key)) || (item.kind === 'funcao' ? AREAS.find(([, re]) => re.test(keyOf(item))) : null)
    if (hit) area = hit[0]
  }
  item.area = area
  ;(result[area] ??= []).push(item)
}
const OVERRIDES = {
  'rota:/line-up-tv/display': '02-viagens-adr', 'rota:/': '01-acesso-admin', 'rota:/painel': '01-acesso-admin',
  'rota:/viagens': '02-viagens-adr', 'rota:/taxas-locais/tabelas': '09a-taxas-locais', 'rota:/taxas-locais': '09b-faturamento',
  'rota:/reconciliacao': '10-recebimento', 'rota:/carga-solta': '03-bl-revisao', 'rota:/carga-solta/:blId': '03-bl-revisao',
  'rota:/perfil': '01-acesso-admin', 'rota:*': '01-acesso-admin', 'servidor:import-effects-runner': '03-bl-revisao',
  'email:resendTemplate': '07-portal', 'email:emailChangeConfirmTemplate': '07-portal', 'email:bounceNotificationTemplate': '07-portal',
  'email:renderNoaTemplate': '06-clientes-comunicacao', 'email:renderNorTemplate': '06-clientes-comunicacao',
  'email:renderNobTemplate': '06-clientes-comunicacao', 'email:renderInstitutionalTemplate': '06-clientes-comunicacao',
  'funcao:current_actor_role': '01-acesso-admin', 'funcao:search_term_tokens': '01-acesso-admin',
  'funcao:operational_list_filter_options': '01-acesso-admin', 'funcao:import_file_previous_upload': '03-bl-revisao',
}
const MSG_FN_OVERRIDES = [
  [/_declare_import_file|import_file_previous_upload/, '03-bl-revisao'], [/_assert_actor_is_caller|check_internal_token_cutoff|internal_revoke_sessions/, '01-acesso-admin'],
  [/guard_single_open_local_document/, '09b-faturamento'], [/_assert_service_caller/, '12-alertas-rotinas'], [/guard_catalog_/, '02-viagens-adr'],
]
for (const item of items) {
  if (OVERRIDES[item.id]) item.area = OVERRIDES[item.id]
  if (item.kind === 'mensagem' && item.area === '00-transversal') {
    const hit = MSG_FN_OVERRIDES.find(([re]) => re.test(item.detail)); if (hit) item.area = hit[1]
  }
  if (item.area === '09-taxas-faturamento') {
    const key = item.kind === 'mensagem' ? item.detail : item.name + ' ' + (item.detail ?? '')
    item.area = /charge_table|charge_tables|tarif|rate_override|pricing|price_freeze|refix|charge_calculation|calculat|calcul|basis|movimento|isen|exempt|thd|reference_date/i.test(key) ? '09a-taxas-locais' : '09b-faturamento'
  }
}
for (const k of Object.keys(result)) delete result[k]
for (const item of items) (result[item.area] ??= []).push(item)
fs.mkdirSync(S + '/manual/areas', { recursive: true })
for (const [area, list] of Object.entries(result)) fs.writeFileSync(S + '/manual/areas/' + area + '.json', JSON.stringify(list, null, 2))
fs.writeFileSync(`${S}/inventario-areas.json`, JSON.stringify(items, null, 2))
for (const [area, list] of Object.entries(result).sort()) {
  const byKind = list.reduce((a, i) => ({ ...a, [i.kind]: (a[i.kind] ?? 0) + 1 }), {})
  console.log(area.padEnd(26), String(list.length).padStart(4), JSON.stringify(byKind))
}
