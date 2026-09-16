import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readMigration(): string {
  const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
  const filename = fs.readdirSync(migrationsDir).find((file) => /^048_.*customer.*primary.*\.sql$/i.test(file))
  if (!filename) throw new Error('Migration 048 de contato primário não encontrada.')
  return fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
}

describe('customer base primary contact migration', () => {
  it('promove o primeiro contato ativo importado quando o cliente ainda não tem principal', () => {
    const sql = readMigration()

    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.apply_customer_base_row_atomic/i)
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.customer_contacts[\s\S]*SELECT\s+v_customer_id,\s*v_name,\s*v_norm,\s*'financeiro',\s*NOT\s+EXISTS/i)
    expect(sql).toMatch(/cc\.is_primary\s*=\s*true[\s\S]*cc\.deactivated_at\s+IS\s+NULL/i)
    expect(sql).toMatch(/UPDATE public\.customer_contacts AS cc[\s\S]*SET is_primary\s*=\s*false[\s\S]*cc\.email_normalized\s+IS\s+NULL/i)
    expect(sql).toMatch(/SET deactivated_at\s*=\s*NULL,[\s\S]*is_primary\s*=\s*NOT\s+EXISTS/i)
    expect(sql).toMatch(/cc\.deactivated_at\s+IS\s+NULL[\s\S]*lower\(btrim\(COALESCE\(cc\.email/i)
    expect(sql).toMatch(/WITH\s+missing_primary\s+AS/i)
    expect(sql).toMatch(/promoted\s+AS\s*\([\s\S]*UPDATE public\.customer_contacts/i)
    expect(sql).toMatch(/FROM\s+promoted[\s\S]*CROSS JOIN public\.customer_communication_boxes/i)
    expect(sql).toMatch(/SET\s+is_primary\s*=\s*true/i)
    expect(sql).toMatch(/email_normalized\s+IS\s+NOT\s+NULL/i)
    expect(sql).toMatch(/REVOKE\s+ALL[\s\S]*apply_customer_base_row_atomic[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated/i)
    expect(sql).toMatch(/GRANT\s+EXECUTE[\s\S]*apply_customer_base_row_atomic[\s\S]*TO\s+authenticated/i)
  })
})
