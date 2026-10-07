import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const describeLocal = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const restore = readFileSync('supabase/migrations/157_restore_customer_communication_catalog.sql', 'utf8')
const cleanup = readFileSync('supabase/scripts/limpar_dados_teste.sql', 'utf8')

describeLocal('Comunicados — recuperação do catálogo estrutural', () => {
  it('a limpeza operacional preserva o catálogo e a chave de envio', () => {
    const result = execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
      BEGIN;
      ${restore}
      CREATE TEMP TABLE before_settings AS SELECT communications_enabled FROM public.app_settings WHERE id=1;
      CREATE TEMP TABLE before_catalogs AS SELECT
        (SELECT count(*) FROM public.customer_communication_boxes) AS boxes,
        (SELECT count(*) FROM public.customer_communication_templates) AS templates;
      ${cleanup}
      SELECT count(*) FROM public.customer_communication_kinds;
      SELECT s.communications_enabled IS NOT DISTINCT FROM b.communications_enabled
      FROM public.app_settings s CROSS JOIN before_settings b WHERE s.id=1;
      SELECT boxes = (SELECT count(*) FROM public.customer_communication_boxes)
        AND templates = (SELECT count(*) FROM public.customer_communication_templates) FROM before_catalogs;
      ROLLBACK;
    `], { encoding: 'utf8' }).trim().split('\n')
    expect(result).toEqual(['10', 't', 't'])
  })

  it('volta a registrar institucional e livre após perda do catálogo, sem ligar envio real', () => {
    const result = execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
      BEGIN;
      SET request.jwt.claim.role = 'service_role';
      TRUNCATE public.customer_communication_kinds CASCADE;
      ${restore}
      ${restore}
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (990215701, '${syntheticCnpj(215701)}', 'QA run-2 catalog');
      SELECT count(*) FROM public.customer_communication_kinds;
      SELECT public.create_customer_communication_atomic(
        p_customer_id := 990215701, p_kind := 'institucional', p_nature := 'avisos_gerais',
        p_dispatch_id := '00000000-0000-0000-0000-000000015701'
      ) IS NOT NULL;
      SELECT public.create_customer_communication_atomic(
        p_customer_id := 990215701, p_kind := 'livre', p_nature := 'documentacao',
        p_dispatch_id := '00000000-0000-0000-0000-000000015702'
      ) IS NOT NULL;
      SELECT bool_and(status = 'simulado') FROM public.customer_communications WHERE customer_id = 990215701;
      ROLLBACK;
    `], { encoding: 'utf8' }).trim().split('\n')
    expect(result).toEqual(['10', 't', 't', 't'])
  })
})
