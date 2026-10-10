import { describe, it } from 'vitest'

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

/**
 * `describe` de suíte `local-pg` com sonda de pré-requisito (Etapa 12 do plano
 * de correção das importações). Sem `LOCAL_PG_INTEGRATION=1` a suíte é pulada,
 * como antes; com a variável ligada, sonda falsa vira um teste que falha e diz
 * o que faltou, em vez de `describe.skip` silencioso.
 */
export function describeWithProbe(probe: () => boolean, requirement: string): typeof describe {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return describe.skip as unknown as typeof describe
  if (probe()) return describe
  const failing = (name: string) => describe(name, () => {
    it(`pré-requisito ausente: ${requirement}`, () => {
      throw new Error(`Sonda falhou com LOCAL_PG_INTEGRATION=1: ${requirement}. Aplique as migrations ou corrija a sonda.`)
    })
  })
  return failing as unknown as typeof describe
}
