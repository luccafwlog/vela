// Validação/normalização pura dos formulários de Taxas Locais. As mensagens de
// erro são exibidas ao usuário, então devem permanecer estáveis.

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

function toAmount(value: string) {
  return Number(String(value).replace(',', '.'))
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
    return { ok: false, error: 'Selecione um cliente para salvar o override.' }
  }
  if (!Number.isInteger(chargeItemId) || chargeItemId <= 0) {
    return { ok: false, error: 'Selecione um item de taxa para salvar o override.' }
  }
  if (!Number.isFinite(overrideValue) || overrideValue <= 0) {
    return { ok: false, error: 'Informe um valor de override valido (maior que zero).' }
  }
  if (form.validFrom && form.validTo && form.validTo < form.validFrom) {
    return { ok: false, error: 'A vigência final não pode ser anterior à vigência inicial.' }
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
    return { ok: false, error: 'Informe o nome da tabela.' }
  }
  if (!form.pod.trim()) {
    return { ok: false, error: 'Informe o POD da tabela.' }
  }
  if (!form.validFrom) {
    return { ok: false, error: 'Informe a vigência inicial da tabela.' }
  }
  if (form.validTo && form.validTo < form.validFrom) {
    return { ok: false, error: 'Vigência final não pode ser anterior à inicial.' }
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

// Espelha `public.normalize_port_code` (migration 063), não
// `normalizePortCode` de `src/services/portCode.ts` — os dois divergem de
// propósito: o de portCode canoniza para LOCODE (`BRVIT` → `BRVIX`), enquanto
// o do banco dobra as duas grafias em `BRVIT`. É o critério do banco que decide
// se duas tabelas caem no mesmo escopo, então é ele que o alerta precisa
// reproduzir; usar o outro agruparia diferente do motor.
export function normalizeChargeTablePod(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (!normalized) return ''
  if (normalized.includes('BRVIT') || normalized.includes('BRVIX') || normalized.includes('VITORIA') || normalized === 'VIX' || normalized === 'VIT') {
    return 'BRVIT'
  }
  if (normalized.includes('BRSSA') || normalized.includes('SALVADOR')) {
    return 'BRSSA'
  }
  return normalized
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
  const unitValue = toAmount(form.unitValue)
  const sortOrder = Number(form.sortOrder)

  if (!Number.isInteger(chargeTableId) || chargeTableId <= 0) {
    return { ok: false, error: 'Selecione a tabela do item.' }
  }
  if (!form.name.trim()) {
    return { ok: false, error: 'Informe o nome do item de taxa.' }
  }
  if (!Number.isFinite(unitValue) || unitValue < 0) {
    return { ok: false, error: 'Valor unitario invalido.' }
  }
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return { ok: false, error: 'Sort order invalido.' }
  }
  return { ok: true, value: { chargeTableId, unitValue, sortOrder } }
}
