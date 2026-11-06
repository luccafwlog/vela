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
 * Migration 574: `cancel_bl` recusa o B/L sem CE Mercante (ele se exclui). A
 * fixture que cancela um B/L sem CE dá a ele, antes, um CE sintético gravado
 * sem gatilhos, para não emitir, calcular nem reconciliar nada além do que o
 * teste mede. Devolve o SQL para o `psql` de superusuário da suíte; B/L que
 * já tem CE fica como está.
 */
export function syntheticCeBeforeCancelSql(...blIds: string[]): string {
  const ids = blIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ')
  return `SET session_replication_role = replica;
    UPDATE public.bls SET ce_mercante = '99' || lpad((abs(hashtext(id))::bigint % 10000000000000)::text, 13, '0')
    WHERE id IN (${ids}) AND NULLIF(btrim(COALESCE(ce_mercante, '')), '') IS NULL;
    SET session_replication_role = origin;`
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

/**
 * Migration 597: B/L de container (ou misto) só recebe o primeiro CE Mercante
 * na viagem ativa em que Equipamentos respondeu "não terá veículos" ou que já
 * tem veículo importado. A fixture que vincula CE sem medir essa trava
 * responde "não terá veículos" pelas viagens dela; quem mede a trava fica em
 * `travaCeMercanteVeiculos.local-pg.test.ts`. Migration 610: também trava sem
 * Baplie; a fixture declara "Viagem sem Baplie" (quem mede essa trava fica em
 * `travaCeMercanteSemBaplie.local-pg.test.ts`). Devolve o SQL para o `psql` da
 * suíte; viagem já respondida fica como está.
 */
export function vehicleAnswerSql(...voyageIds: number[]): string {
  if (voyageIds.length === 0) return ''
  const values = voyageIds.map((id) => {
    if (!Number.isInteger(id)) throw new Error(`Viagem inválida para a resposta de veículos: ${id}`)
    return `(${id}, '00000000-0000-4000-8000-000000000595'::uuid)`
  }).join(', ')
  const baplie = voyageIds.map((id) => `(${id}, 'fixture de teste', '00000000-0000-4000-8000-000000000595'::uuid)`).join(', ')
  return `INSERT INTO public.voyage_vehicle_declarations (voyage_id, declared_by) VALUES ${values} ON CONFLICT (voyage_id) DO NOTHING;
    INSERT INTO public.voyage_baplie_declarations (voyage_id, reason, declared_by) VALUES ${baplie} ON CONFLICT (voyage_id) DO NOTHING;`
}
