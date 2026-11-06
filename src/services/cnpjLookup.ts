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

/** Perfil do Cliente criado pela Revisão (`p_profile` da migration 595). */
export type ReviewCustomerProfile = {
  trade_name: string
  address: string
  city: string
  state: string
  zip: string
}

/** Dados da Receita que a Revisão grava no Cliente novo; null sem endereço nem nome fantasia. */
export function reviewProfileFromLookup(data: CnpjLookupData | null | undefined): ReviewCustomerProfile | null {
  if (!data) return null
  const profile = { trade_name: data.nome_fantasia, address: data.endereco, city: data.cidade, state: data.uf, zip: data.cep }
  return Object.values(profile).some((value) => value.trim()) ? profile : null
}
