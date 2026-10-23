import { execPsql } from './localPsql'
import { expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 431 (auditoria run-3, nota de endurecimento): a cobrança reservada e
// não chamada volta sem contar tentativa. Transação descartada no fim.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string): string[] {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim().split(/\r?\n/)
}

function migration419Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.itau_pix_release(bigint[])') IS NOT NULL;`)[0] === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration419Applied, 'migration419Applied (Itaú libera reserva não chamada)')

describeLocal('431 — Itaú libera a reserva não chamada', () => {
  it('devolve a tentativa e a vez só da reserva vigente', () => {
    const out = psql(`BEGIN;
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (419001, '${syntheticCnpj(41901)}', 'Cliente C419');
      INSERT INTO public.carriers (id, name) VALUES (419010, 'Carrier C419');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (419011, 'Vessel C419', 419010);
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (419012, 419011, 'V419', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, ce_mercante) VALUES ('C419-BL', 419012, 419001, 'CE419');
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, status)
        VALUES (419021, 'DEM-C419', 'C419-BL', 419001, 100, 'issued'), (419022, 'DEM-C419-2', 'C419-BL', 419001, 100, 'issued');
      INSERT INTO public.itau_pix_charges (demurrage_invoice_id, txid, amount_brl, expiration_seconds, attempts, next_attempt_at)
        VALUES (419021, 'VELAC419000000000000000000000001', 10, 3600, 1, now() + interval '1 minute'),
               (419022, 'VELAC419000000000000000000000002', 10, 3600, 1, now() - interval '1 minute');
      SELECT public.itau_pix_release(ARRAY(SELECT id FROM public.itau_pix_charges WHERE demurrage_invoice_id IN (419021, 419022)));
      SELECT string_agg(attempts || ':' || (next_attempt_at <= now()), ',' ORDER BY demurrage_invoice_id)
        FROM public.itau_pix_charges WHERE demurrage_invoice_id IN (419021, 419022);
      ROLLBACK;`)
    // Só a reserva vigente (a 1ª) volta; a 2ª já não estava reservada.
    expect(out.slice(-2)).toEqual(['1', '0:true,1:true'])
  })
})
