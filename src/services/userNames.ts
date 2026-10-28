import { supabase } from './supabase'

const CHUNK = 200

/**
 * Nome de quem fez cada registro do Histórico, para todos os setores
 * (ACE-D16 de 2026-10-27; ADR 0106). A leitura do cadastro de usuários continua
 * do Administrativo: a função do banco devolve só o id e o nome.
 */
export async function fetchUserDisplayNames(ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(Array.from(ids).filter((id): id is string => Boolean(id))))
  const names = new Map<string, string>()
  for (let start = 0; start < unique.length; start += CHUNK) {
    const { data, error } = await supabase.rpc('get_user_display_names' as never, { p_user_ids: unique.slice(start, start + CHUNK) } as never)
    if (error) throw error
    for (const row of (data ?? []) as Array<{ user_id: string; full_name: string | null }>) {
      const name = String(row.full_name ?? '').trim()
      if (name) names.set(row.user_id, name)
    }
  }
  return names
}
