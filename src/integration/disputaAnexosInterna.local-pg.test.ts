import { execPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

// Migration 469 (DEM-D01): a conversa interna da Disputa traz os anexos de
// cada mensagem, com o caminho no bucket que o link temporário usa.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

const ADMIN = '46900000-0000-4000-8000-000000000001'

describeLocal('migration 469 — anexos na conversa interna da Disputa', () => {
  it('lista o nome, o tipo, o tamanho e o caminho de cada anexo da mensagem', () => {
    const out = psql(`
      BEGIN;
      SET LOCAL session_replication_role = replica;
      INSERT INTO auth.users (id, email) VALUES ('${ADMIN}', 'adm469@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADMIN}', 'Adm 469', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (4690010, '46900000000110', 'Cliente 469');
      INSERT INTO public.carriers (id, name) VALUES (4690001, 'Carrier 469');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (4690002, 'Navio 469', 4690001);
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (4690003, 4690002, 'V469', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode) VALUES ('B469A', 4690003, 4690010, 'container');
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, status) VALUES (4690100, 'DEM-469', 'B469A', 4690010, 100, 'issued');
      INSERT INTO public.demurrage_disputes (id, demurrage_invoice_id, customer_id, state, next_responder, subject, opened_by)
        VALUES (4690200, 4690100, 4690010, 'aberta', 'equipamentos', 'Datas', 'cliente');
      INSERT INTO public.demurrage_dispute_messages (id, dispute_id, author_type, body, next_responder)
        VALUES (4690300, 4690200, 'cliente', 'Segue o comprovante', 'equipamentos');
      INSERT INTO public.demurrage_dispute_attachments (message_id, dispute_id, customer_id, storage_path, file_name, mime_type, size_bytes)
        VALUES (4690300, 4690200, 4690010, '4690010/disputes/4690200/4690300/x-comprovante.pdf', 'comprovante.pdf', 'application/pdf', 1234);
      SET LOCAL session_replication_role = origin;
      SET LOCAL request.jwt.claim.role = 'authenticated';
      SET LOCAL request.jwt.claim.sub = '${ADMIN}';
      SELECT (d->'messages'->0->'attachments'->0)::text
        FROM jsonb_array_elements(public.list_demurrage_disputes_internal(NULL)) d WHERE (d->>'id')::bigint = 4690200;
      ROLLBACK;
    `)
    const attachment = JSON.parse(out.split('\n').at(-1) ?? '{}')
    expect(attachment).toMatchObject({
      file_name: 'comprovante.pdf', mime_type: 'application/pdf', size_bytes: 1234,
      storage_path: '4690010/disputes/4690200/4690300/x-comprovante.pdf',
    })
  })
})
