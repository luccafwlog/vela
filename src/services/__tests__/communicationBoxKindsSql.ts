import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CommunicationBoxKind } from '../customerCommunicationBoxes'

// O mapa caixa → modelo vive no banco (`customer_communication_box_kinds`).
// Os testes de unidade leem as linhas semeadas pela migration 116 em vez de
// manter uma cópia no navegador ou no teste.
export function communicationBoxKindsFromMigrations(): CommunicationBoxKind[] {
  const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/116_restaura_caixas_de_comunicacao.sql'), 'utf8')
  const block = sql.match(/INSERT INTO public\.customer_communication_box_kinds \(box_code, kind\)\s*VALUES([\s\S]*?)ON CONFLICT/)
  if (!block) throw new Error('Semente de customer_communication_box_kinds não encontrada na migration 116.')
  return [...block[1].matchAll(/\('([a-z_]+)',\s*'([a-z_]+)'\)/g)].map(([, box_code, kind]) => ({ box_code, kind }))
}
