// Migration 486 (revisão da PR #1070; decisões do dono de 2026-10-27): o
// Comunicado redirecionado ao suporte abre o alerta de reenvio de CE; o Novo
// cliente é só dos setores dos contatos; o CNPJ antigo fora da regra não trava
// a edição; o contato digitado pela equipe leva o autor. Cada cenário roda numa
// transação desfeita no fim.
//
// Namespace exclusivo: Viagem 99486003, Cliente 99486004, usuários ...000486NNN.
import { spawnPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const DOC = '00000000-0000-0000-0000-000000486001'
const FIN = '00000000-0000-0000-0000-000000486002'

const USERS = `
  INSERT INTO auth.users (id, email) VALUES ('${DOC}', 'a486-doc@example.test'), ('${FIN}', 'a486-fin@example.test');
  INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
    ('${DOC}', 'A486 Paula', 'documentacao', true), ('${FIN}', 'A486 Rafael', 'financeiro', true);
`
const as = (user: string) => `SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '${user}', true);`

/** Roda o cenário numa transação desfeita; devolve as linhas que começam com '>'. */
function scenario(sql: string): { lines: string[]; stderr: string } {
  const run = spawnPsql(['-X', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${USERS} ${sql} ROLLBACK;`],
    { encoding: 'utf8' })
  return { lines: run.stdout.split('\n').filter((line) => line.startsWith('>')), stderr: run.stderr }
}

describeLocal('Comunicados e Clientes: ajustes da revisão (migration 486)', () => {
  it('M2: com o Comunicado de CE redirecionado ao suporte (simulado), trocar o CE abre o alerta de reenvio', () => {
    const { lines, stderr } = scenario(`
      SET LOCAL request.jwt.claim.role = 'service_role';
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (99486001, 'Armador R486');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (99486002, 'Navio R486', 99486001);
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (99486003, 99486002, 'R486V', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (99486004, 'CLIENTE R486 LTDA', '11444777000161');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status, ce_mercante)
        VALUES ('R486-SIM', 99486003, 99486004, 'CNSHA', 'BRSSZ', 'container', 'invoiced', 'calculated', 'ok', '994860000000001');
      INSERT INTO public.customer_communications (id, customer_id, kind, nature, anchor_voyage_id, anchor_port, status, attempt_discriminator, created_at)
        VALUES (99486010, 99486004, 'ce_mercante_taxas', 'documentacao', 99486003, 'BRSSZ', 'simulado', 0, now() - interval '1 day');
      INSERT INTO public.customer_communication_bls (communication_id, bl_id) VALUES (99486010, 'R486-SIM');
      SET LOCAL session_replication_role = origin;
      SELECT public._set_bl_ce_mercante('R486-SIM', '994860000000099', NULL, 'teste', 'revisao') IS NOT NULL;
      SELECT '>alerta=' || i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
        WHERE i.item_type = 'comunicado_ce_reenvio_pendente' AND a.entity_id = 'R486-SIM';
    `)
    expect(stderr).not.toMatch(/ERROR/)
    expect(lines).toEqual(['>alerta=active'])
  })

  it('P10: o Financeiro não cria Cliente pelo Novo cliente; a Documentação cria', () => {
    const create = `SELECT public.create_customer_with_contacts('{"cnpj_cpf":"11222333000181","name":"R486 NOVO"}'::jsonb,
      '[{"email":"contato-486@example.test","is_primary":true,"name":"Compras"}]'::jsonb) IS NOT NULL;`
    const refused = scenario(`${as(FIN)} ${create}`)
    expect(refused.stderr).toMatch(/Novo cliente é de Administrativo, Documentação e Equipamentos/)
    const created = scenario(`${as(DOC)} ${create} SELECT '>contatos=' || count(*) FROM public.customer_contacts c
      JOIN public.customers cu ON cu.id = c.customer_id WHERE cu.name = 'R486 NOVO';`)
    expect(created.stderr).not.toMatch(/ERROR/)
    expect(created.lines).toEqual(['>contatos=1'])
  })

  it('P10: o Financeiro segue cadastrando o Cliente do manifesto pela ficha do B/L, com o e-mail do documento', () => {
    const { lines, stderr } = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (99486101, 'Armador R486M');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (99486102, 'Navio R486M', 99486101);
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (99486103, 99486102, 'R486M', 'active');
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, manifest_customer_name, manifest_customer_cnpj_cpf, manifest_customer_email)
        VALUES ('R486-MAN', 99486103, 'CNSHA', 'BRSSZ', 'container', 'R486 MANIFESTO LTDA', '11.222.333/0001-81', 'Docs@Manifesto486.test');
      SET LOCAL session_replication_role = origin;
      ${as(FIN)}
      SELECT public.create_customer_from_bl_manifest('R486-MAN') IS NOT NULL;
      SELECT '>' || cu.name || ':' || c.email || ':' || c.is_primary FROM public.customers cu
        JOIN public.customer_contacts c ON c.customer_id = cu.id WHERE cu.cnpj_cpf = '11222333000181';
    `)
    expect(stderr).not.toMatch(/ERROR/)
    expect(lines).toEqual(['>R486 MANIFESTO LTDA:docs@manifesto486.test:true'])
  })

  it('B10: Cliente antigo com CNPJ de dígitos repetidos continua editável; gravar um CNPJ assim segue recusado', () => {
    const { lines, stderr } = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (99486005, 'R486 LEGADO', '00000000000000');
      SET LOCAL session_replication_role = origin;
      UPDATE public.customers SET address = 'Rua Nova, 1' WHERE id = 99486005;
      SELECT '>endereco=' || address FROM public.customers WHERE id = 99486005;
      DO $$ BEGIN
        UPDATE public.customers SET cnpj_cpf = '11111111111111' WHERE id = 99486005;
        RAISE EXCEPTION 'aceitou CNPJ de dígitos repetidos';
      EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'recusado'; END $$;
      SELECT '>cnpj=' || cnpj_cpf FROM public.customers WHERE id = 99486005;
    `)
    expect(stderr).not.toMatch(/ERROR/)
    expect(lines).toEqual(['>endereco=Rua Nova, 1', '>cnpj=00000000000000'])
  })

  it('B12: o e-mail digitado pela equipe na Revisão grava o autor na alteração do cadastro', () => {
    const { lines, stderr } = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (99486006, 'R486 REVISAO', '11444777000161');
      SET LOCAL session_replication_role = origin;
      ${as(DOC)}
      SELECT public._ensure_customer_contact_email(99486006, 'compras-486@example.test', 'Compras', 'financeiro', NULL, 'interno') IS NOT NULL;
      SELECT '>' || source || ':' || coalesce(actor_id::text, 'sem autor') FROM public.customer_contact_change_events WHERE customer_id = 99486006;
    `)
    expect(stderr).not.toMatch(/ERROR/)
    expect(lines).toEqual([`>interno:${DOC}`])
  })
})
