// Validação/normalização pura dos formulários de Taxas Locais. As mensagens de
// erro são exibidas ao usuário, então devem permanecer estáveis.

// `field` aponta o campo do erro para o formulário mostrá-lo junto do campo.
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string; field?: string }

// Aceita "1420.5", "1420,50" e "1.420,50" (milhar com ponto e decimal com
// vírgula, como o operador digita em pt-BR). Sem vírgula, ponto seguido de
// exatamente três dígitos é milhar ("1.420" = 1420). Vírgula depois de ponto
// ("1,420.50", formato americano) é recusada: lida como pt-BR viraria 1,42.
export function toAmount(value: string) {
  const text = String(value).trim().replace(/\s|R\$|US\$/g, '')
  if (text.includes(',')) {
    // Com vírgula, só vale pt-BR: uma vírgula decimal, pontos apenas como
    // milhar antes dela. "1,420.50" e "1,2,3" são recusados.
    if (!/^-?(\d+|\d{1,3}(\.\d{3})+),\d*$/.test(text)) return Number.NaN
  }
  if (text.includes(',')) return Number(text.replace(/\./g, '').replace(',', '.'))
  if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) return Number(text.replace(/\./g, ''))
  return Number(text)
}

// Override por cliente.

export type OverrideInput = {
  customerId: string
  chargeItemId: string
  overrideValue: string
  validFrom: string
  validTo: string
  notes: string
}

export type OverridePayload = {
  customerId: number
  chargeItemId: number
  overrideValue: number
  validFrom: string | null
  validTo: string | null
  notes: string | null
}

export function validateOverrideInput(form: OverrideInput): ValidationResult<OverridePayload> {
  const customerId = Number(form.customerId)
  const chargeItemId = Number(form.chargeItemId)
  const overrideValue = toAmount(form.overrideValue)

  if (!Number.isInteger(customerId) || customerId <= 0) {
    return { ok: false, field: 'customerId', error: 'Selecione o Cliente da condição.' }
  }
  if (!Number.isInteger(chargeItemId) || chargeItemId <= 0) {
    return { ok: false, field: 'chargeItemId', error: 'Selecione o item de taxa da condição.' }
  }
  if (!Number.isFinite(overrideValue) || overrideValue <= 0) {
    return { ok: false, field: 'overrideValue', error: 'Informe o valor negociado (maior que zero).' }
  }
  if (form.validFrom && form.validTo && form.validTo < form.validFrom) {
    return { ok: false, field: 'validTo', error: 'A vigência final não pode ser anterior à vigência inicial.' }
  }

  return {
    ok: true,
    value: {
      customerId,
      chargeItemId,
      overrideValue,
      validFrom: form.validFrom || null,
      validTo: form.validTo || null,
      notes: form.notes || null,
    },
  }
}

// Tabela de taxas.

export type TableInput = {
  name: string
  pod: string
  validFrom: string
  validTo: string
}

export function validateTableInput(form: TableInput): ValidationResult<{ validTo: string | null }> {
  if (!form.name.trim()) {
    return { ok: false, field: 'name', error: 'Informe o nome da tabela.' }
  }
  if (!form.pod.trim()) {
    return { ok: false, field: 'pod', error: 'Informe o POD da tabela.' }
  }
  if (!form.validFrom) {
    return { ok: false, field: 'validFrom', error: 'Informe a vigência inicial da tabela.' }
  }
  if (form.validTo && form.validTo < form.validFrom) {
    return { ok: false, field: 'validTo', error: 'Vigência final não pode ser anterior à inicial.' }
  }
  return { ok: true, value: { validTo: form.validTo || null } }
}

// Avisos de vigência da tabela de taxas (ADR 0040).
//
// A vigência da Tabela de Taxas Locais é informativa: o motor resolve a tabela
// por escopo (modo de carga + POD) e por `active`, sem olhar o período. Como a
// vigência deixou de excluir tabela nenhuma, ela precisa aparecer como aviso —
// caso contrário um período vencido ou futuro passa a mentir em silêncio, e
// duas tabelas ativas do mesmo escopo viram uma escolha invisível do motor.

export type ChargeTableValidityRow = {
  id: number
  cargo_mode: 'container' | 'carga_solta' | 'granito' | null
  pod: string | null
  valid_from: string
  valid_to: string | null
  active: boolean | null
}

export type ChargeTableAlert = {
  tone: 'yellow' | 'red'
  label: string
  hint: string
}

// Espelha `public.normalize_port_code` como está hoje no banco (baseline 002,
// herdeira das migrations 353, 361 e 365): lista exata de aliases, sem
// "contém". É o critério do banco que decide se duas tabelas caem no mesmo
// escopo, então é ele que a tela reproduz; `normalizePortCode` de
// `src/services/portCode.ts` é mais tolerante e agruparia diferente do motor.
// Se a função do banco mudar, esta lista precisa acompanhar.
const ENGINE_PORT_ALIASES: Array<[string, string[]]> = [
  ['BRVIX', ['BRVIT', 'VITORIA', 'VITÓRIA', 'BRVIX', 'VIX']],
  ['BRSSA', ['SALVADOR', 'BRSSA', 'SSA']],
  ['BRPEC', ['PECEM', 'PECÉM', 'BRPEC', 'PEC']],
  ['BRSSZ', ['SANTOS', 'BRSSZ', 'SSZ']],
  ['BRPNG', ['PARANAGUA', 'PARANAGUÁ', 'BRPNG', 'PNG']],
  ['BRITJ', ['ITAJAI', 'ITAJAÍ', 'BRITJ', 'ITJ', 'NAVEGANTES', 'BRNVT', 'NVT']],
  ['BRRIG', ['RIO GRANDE', 'BRRIG', 'RIG']],
  ['BRSUA', ['SUAPE', 'RECIFE', 'BRSUA', 'SUA', 'BRREC']],
  ['BRRIO', ['RIO DE JANEIRO', 'BRRIO', 'BRRDJ']],
  ['BRMAO', ['MANAUS', 'BRMAO']],
  ['CNTAO', ['QINGDAO', 'QINDGAO', 'TSINGTAO', 'CNTAO', 'CNQDG', 'QDG']],
  ['CNSHA', ['SHANGHAI', 'CNSHA', 'CNSHG', 'SHG']],
  ['CNTAC', ['TAICANG', 'TAIKANG', 'CNTAC', 'CNTAI', 'CNTAG']],
  ['CNNGB', ['NINGBO', 'CNNGB', 'CNNBO', 'NBO', 'ZHOUSHAN', 'CNZOS', 'ZOS']],
  ['CNNSA', ['NANSHA', 'CNNSA', 'CNNAN', 'GUANGZHOU', 'CNGZU']],
  ['CNZJG', ['ZHANGJIAGANG', 'CNZJG']],
  ['CNXMN', ['XIAMEN', 'AMOY', 'CNXMN', 'XMN']],
  ['CNSHK', ['SHEKOU', 'SHENZHEN', 'CNSHK', 'CNSZK', 'CNSHE']],
  ['CNYTN', ['YANTIAN', 'CNYTN', 'YTN']],
  ['HKHKG', ['HONG KONG', 'HONGKONG', 'HKHKG', 'HKG']],
]
const ENGINE_PORT_CODE = new Map(ENGINE_PORT_ALIASES.flatMap(([code, aliases]) => aliases.map((alias) => [alias, code] as const)))

export function normalizeChargeTablePod(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (!normalized) return ''
  return ENGINE_PORT_CODE.get(normalized) ?? normalized
}

function scopeKey(table: ChargeTableValidityRow) {
  return `${table.cargo_mode ?? ''}|${normalizeChargeTablePod(table.pod)}`
}

// Mesmo desempate do motor (resolve_local_charge_table_id, migration 274):
// entre tabelas ativas do mesmo escopo vence a de vigência inicial mais
// recente, com o maior id como critério estável de segundo nível.
function enginePrecedence(a: ChargeTableValidityRow, b: ChargeTableValidityRow) {
  if (a.valid_from !== b.valid_from) return a.valid_from < b.valid_from ? 1 : -1
  return b.id - a.id
}

// Situação de cada tabela no cálculo, com o mesmo critério do motor
// (resolve_local_charge_table_id, migration 274): por modo de carga + POD
// normalizado, só entre ativas; vence a de vigência inicial mais recente.
export type ChargeTableEngineState =
  | { kind: 'applied' }
  | { kind: 'shadowed'; winnerId: number }
  | { kind: 'inactive' }

export function chargeTableScopeKey(table: Pick<ChargeTableValidityRow, 'cargo_mode' | 'pod'>) {
  return scopeKey(table as ChargeTableValidityRow)
}

export function resolveChargeTableStates(tables: ChargeTableValidityRow[]): Map<number, ChargeTableEngineState> {
  const winners = new Map<string, ChargeTableValidityRow>()
  for (const table of tables) {
    if (!table.active) continue
    const key = scopeKey(table)
    const current = winners.get(key)
    if (!current || enginePrecedence(table, current) < 0) winners.set(key, table)
  }
  const states = new Map<number, ChargeTableEngineState>()
  for (const table of tables) {
    if (!table.active) {
      states.set(table.id, { kind: 'inactive' })
      continue
    }
    const winner = winners.get(scopeKey(table))
    states.set(table.id, winner && winner.id !== table.id ? { kind: 'shadowed', winnerId: winner.id } : { kind: 'applied' })
  }
  return states
}

export function chargeTableAlerts(
  tables: ChargeTableValidityRow[],
  today: string,
): Map<number, ChargeTableAlert[]> {
  const activeByScope = new Map<string, ChargeTableValidityRow[]>()
  for (const table of tables) {
    if (!table.active) continue
    const key = scopeKey(table)
    const bucket = activeByScope.get(key)
    if (bucket) bucket.push(table)
    else activeByScope.set(key, [table])
  }

  const shadowed = new Set<number>()
  for (const bucket of activeByScope.values()) {
    if (bucket.length < 2) continue
    const [, ...losers] = [...bucket].sort(enginePrecedence)
    for (const loser of losers) shadowed.add(loser.id)
  }

  const alerts = new Map<number, ChargeTableAlert[]>()
  for (const table of tables) {
    const rows: ChargeTableAlert[] = []

    if (table.active && table.valid_to && table.valid_to < today) {
      rows.push({
        tone: 'yellow',
        label: 'Vigência vencida',
        hint: 'A vigência é informativa: a tabela continua sendo aplicada no cálculo enquanto estiver ativa. Inative-a para tirá-la do ar.',
      })
    }
    if (table.active && table.valid_from > today) {
      rows.push({
        tone: 'yellow',
        label: 'Vigência futura',
        hint: 'A vigência é informativa: a tabela já é considerada no cálculo, mesmo antes da data inicial.',
      })
    }
    if (shadowed.has(table.id)) {
      rows.push({
        tone: 'red',
        label: 'Não aplicada',
        hint: 'Existe outra tabela ativa para o mesmo POD e modo de carga, com vigência inicial mais recente — é ela que o cálculo usa. Inative uma das duas.',
      })
    }

    if (rows.length > 0) alerts.set(table.id, rows)
  }

  return alerts
}

// Item de tabela de taxas.

export type TableItemInput = {
  chargeTableId: string
  name: string
  unitValue: string
  sortOrder: string
}

export function validateTableItemInput(
  form: TableItemInput,
): ValidationResult<{ chargeTableId: number; unitValue: number; sortOrder: number }> {
  const chargeTableId = Number(form.chargeTableId)
  const unitValue = String(form.unitValue).trim() ? toAmount(form.unitValue) : Number.NaN
  const sortOrder = Number(form.sortOrder)

  if (!Number.isInteger(chargeTableId) || chargeTableId <= 0) {
    return { ok: false, field: 'chargeTableId', error: 'Selecione a tabela do item.' }
  }
  if (!form.name.trim()) {
    return { ok: false, field: 'name', error: 'Informe o nome do item de taxa.' }
  }
  if (!Number.isFinite(unitValue) || unitValue < 0) {
    return { ok: false, field: 'unitValue', error: 'Informe um valor unitário válido (zero ou maior).' }
  }
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return { ok: false, field: 'sortOrder', error: 'A ordem de exibição deve ser um número inteiro, zero ou maior.' }
  }
  return { ok: true, value: { chargeTableId, unitValue, sortOrder } }
}
