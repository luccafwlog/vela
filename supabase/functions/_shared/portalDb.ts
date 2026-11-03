// Tipos estruturais mínimos do cliente Supabase usados pelos helpers do Portal.
//
// Os helpers ficam fora do `index.ts` de cada Edge Function porque o teste
// precisa importá-los, e `index.ts` importa `createClient` pelo npm (`npm:@supabase/supabase-js`),
// que o Vitest não resolve. Este arquivo não importa nada: só descreve a forma
// do que os helpers chamam, para que um duplo de teste possa satisfazê-la.

export type PortalDbRow = Record<string, unknown>

export type PortalDbResult<T> = { data: T; error?: unknown }

export type PortalQuery = {
  select(columns?: string): PortalQuery
  insert(values: PortalDbRow): PortalQuery
  update(values: PortalDbRow): PortalQuery
  eq(column: string, value: unknown): PortalQuery
  neq(column: string, value: unknown): PortalQuery
  gt(column: string, value: unknown): PortalQuery
  order(column: string, options?: { ascending?: boolean }): PortalQuery
  limit(count: number): PortalQuery
  maybeSingle(): Promise<PortalDbResult<PortalDbRow | null>>
}

export type PortalDb = {
  rpc(name: string, params?: PortalDbRow): Promise<PortalDbResult<unknown>>
  from(table: string): PortalQuery
}
