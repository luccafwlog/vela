/**
 * Gera um CNPJ determinístico e válido para fixtures locais.
 * O prefixo 99 identifica dados sintéticos sem depender de um CNPJ real.
 */
export function syntheticCnpj(namespace: number): string {
  const base = `99${String(namespace).padStart(10, '0')}`
  if (!/^\d{12}$/.test(base)) throw new Error(`Namespace de CNPJ inválido: ${namespace}`)

  const first = checkDigit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const second = checkDigit(`${base}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${base}${first}${second}`
}

function checkDigit(value: string, weights: readonly number[]): number {
  const sum = [...value].reduce((total, digit, index) => total + Number(digit) * weights[index], 0)
  const remainder = sum % 11
  return remainder < 2 ? 0 : 11 - remainder
}
