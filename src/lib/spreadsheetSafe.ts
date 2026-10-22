// Neutraliza injeção de fórmula (CSV/Excel injection). Um valor iniciado por
// = + - @ ou tab/CR é interpretado como fórmula ao abrir no Excel/Sheets;
// prefixar com aspa simples força o tratamento como texto literal.
// Espaços à esquerda e as variantes de largura total (＝＋－＠) também abrem
// fórmula em algumas planilhas (auditoria run-2, reforço).
export const FORMULA_INJECTION_PREFIX = /^[\s\u3000]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20\t\r]/

export function sanitizeCellValue<T>(value: T): T | string {
  if (typeof value === 'string' && FORMULA_INJECTION_PREFIX.test(value)) {
    return `'${value}`
  }
  return value
}

// A chave vira o cabeçalho da coluna (`json_to_sheet`) e pode vir de dado
// cadastrado (o nome da taxa na Validação de Taxas Locais): passa pela mesma
// neutralização do valor.
export function sanitizeSheetRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      out[String(sanitizeCellValue(key))] = sanitizeCellValue(value)
    }
    return out
  })
}
