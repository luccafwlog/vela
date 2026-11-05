import { z } from 'zod'
import { supabase } from './supabase'

// Consulta de CNPJ na BrasilAPI pela Edge Function `cnpj-lookup` (ADR 0126).
// O navegador não fala com a BrasilAPI: a CSP do Vela não libera o host.

const lookupDataSchema = z.object({
  cnpj: z.string(),
  razao_social: z.string(),
  nome_fantasia: z.string(),
  cep: z.string(),
  endereco: z.string(),
  cidade: z.string(),
  uf: z.string(),
  situacao: z.string(),
})

const lookupResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('encontrado'), data: lookupDataSchema }),
  z.object({ status: z.literal('nao_encontrado') }),
  z.object({ status: z.literal('indisponivel') }),
])

export type CnpjLookupData = z.infer<typeof lookupDataSchema>
export type CnpjLookupResult = z.infer<typeof lookupResponseSchema>

/**
 * Nunca lança: qualquer falha (rede, recusa, resposta fora do contrato) vira
 * `indisponivel`, e o cadastro segue à mão.
 */
export async function lookupCnpj(cnpj: string): Promise<CnpjLookupResult> {
  try {
    const { data, error } = await supabase.functions.invoke('cnpj-lookup', { body: { cnpj } })
    if (error) return { status: 'indisponivel' }
    const parsed = lookupResponseSchema.safeParse(data)
    return parsed.success ? parsed.data : { status: 'indisponivel' }
  } catch {
    return { status: 'indisponivel' }
  }
}
