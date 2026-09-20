const ISO_CONTAINER_NUMBER = /^[A-Z]{4}\d{7}$/

export function normalizeIsoContainerNumber(value: string | null | undefined) {
  const normalized = String(value ?? '').replace(/\s+/g, '').toUpperCase()
  return ISO_CONTAINER_NUMBER.test(normalized) ? normalized : null
}

// Valor de cada letra para o dígito verificador ISO 6346 (anexo A): a série
// pula os múltiplos de 11 (11, 22, 33) porque o dígito verificador é ele
// próprio módulo 11 — um valor de letra múltiplo de 11 nunca poderia mudar o
// resto e tornaria duas letras equivalentes para o checksum.
const ISO_6346_LETTER_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
}

/**
 * Dígito verificador do container pelo Anexo A da ISO 6346 (módulo 11 sobre
 * as 10 primeiras posições, cada uma pesada por 2^posição). Resultado 10 vira
 * dígito 0, por convenção da norma.
 *
 * `null` quando `owner+serial` (as 10 primeiras posições) não têm o formato
 * de container: quem chama decide se isso é "sem dígito calculável" ou erro.
 */
export function computeIsoContainerCheckDigit(ownerAndSerial: string): number | null {
  const normalized = ownerAndSerial.trim().toUpperCase()
  if (!/^[A-Z]{4}\d{6}$/.test(normalized)) return null

  let sum = 0
  for (let position = 0; position < 10; position += 1) {
    const char = normalized[position]!
    const value = position < 4 ? ISO_6346_LETTER_VALUES[char] : Number(char)
    if (value === undefined || !Number.isFinite(value)) return null
    sum += value * 2 ** position
  }
  const remainder = sum % 11
  return remainder === 10 ? 0 : remainder
}

/**
 * Valida o container completo (owner + serial + dígito verificador) contra a
 * ISO 6346, incluindo o checksum. Mais estrito que `normalizeIsoContainerNumber`
 * (formato apenas) — ver nota de uso.
 *
 * ponytail: esta função existe, é testada, mas nenhum parser a chama ainda.
 * `normalizeIsoContainerNumber` é usado por oito parsers de import em
 * produção (blParser, baplieParser, vehicleImport, vaziosImport,
 * vaziosImportacaoImport, blFreightImport); ligar o checksum ali de uma vez,
 * sem uma base de EDI/B/L reais para validar o algoritmo contra dado de
 * produção, arriscaria rejeitar silenciosamente containers legítimos em
 * todos os fluxos de uma vez. Upgrade: validar `computeIsoContainerCheckDigit`
 * contra uma amostra real antes de qualquer parser passar a usar esta função
 * em vez de `normalizeIsoContainerNumber`.
 */
export function isValidIsoContainerNumber(value: string | null | undefined): boolean {
  const normalized = normalizeIsoContainerNumber(value)
  if (!normalized) return false
  const expected = computeIsoContainerCheckDigit(normalized.slice(0, 10))
  return expected !== null && expected === Number(normalized[10])
}
