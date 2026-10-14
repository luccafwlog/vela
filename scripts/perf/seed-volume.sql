-- Volume sintético para `measure-screens.mjs` (só no banco local descartável).
-- ~2 anos de operação: 200 viagens, 12 mil B/Ls, 28 mil contêineres, 14 mil
-- veículos, 400 clientes, 3 mil alertas, 4 mil faturas, 24 mil linhas de auditoria.
-- Roda depois do seed do stack local: psql -d app -f scripts/perf/seed-volume.sql
begin;
set local session_replication_role = replica;

insert into public.carriers (id, name, scac) values (51,'Perf Line','PRFL') on conflict do nothing;
insert into public.vessels (id, name, imo, carrier_id)
select 100 + g, 'PERF VESSEL ' || g, (9800000 + g)::text, case when g % 2 = 0 then 50 else 51 end
from generate_series(1, 20) g on conflict do nothing;

insert into public.customers (id, cnpj_cpf, name, trade_name, city, state)
select 1000 + g,
  lpad((10000000 + g)::text, 8, '0') || '0001' || lpad((g % 97)::text, 2, '0'),
  'Cliente Perf ' || g || ' Comércio Exterior Ltda', 'Perf ' || g,
  (array['Santos','Vitória','Itajaí','São Paulo','Campinas'])[1 + g % 5],
  (array['SP','ES','SC','SP','SP'])[1 + g % 5]
from generate_series(1, 400) g;

insert into public.voyages (id, vessel_id, voyage_number, pol_id, pod_id, etd, eta, status, created_at)
select 1000 + g, 100 + (g % 20), lpad(g::text, 3, '0') || (array['E','W','S','N'])[1 + g % 4],
  (select id from ports where locode = (array['CNSHA','CNNGB'])[1 + g % 2] order by id limit 1),
  (select id from ports where locode = (array['BRSSZ','BRVIX'])[1 + g % 2] order by id limit 1),
  now() - (g * interval '3.6 days') - interval '30 days',
  now() - (g * interval '3.6 days'),
  case when g <= 8 then 'active' else 'completed' end,
  now() - (g * interval '3.6 days') - interval '35 days'
from generate_series(1, 200) g;

insert into public.import_batches (id, voyage_id, filename, status, cargo_mode, uploaded_at)
select 1000 + g, 1000 + g, 'PERF_' || g || '_manifest.xlsx', 'completed', 'container', now() - (g * interval '3.6 days')
from generate_series(1, 200) g;

-- 60 BLs per voyage
insert into public.bls (id, voyage_id, batch_id, shipper, consignee, customer_id, pol, pod, cargo_description,
  total_weight_kg, total_cbm, payment_type, financial_status, review_status, cargo_mode, ce_mercante,
  charge_status, container_load_type, manifest_customer_cnpj_cpf, manifest_customer_name,
  customer_reconciliation_status, created_at)
select 'PERF' || lpad(n::text, 10, '0'), 1000 + v, 1000 + v,
  'Shipper Perf ' || (n % 300), 'Cliente Perf ' || (1 + n % 400) || ' Comércio Exterior Ltda',
  case when n % 23 = 0 then null else 1000 + 1 + n % 400 end,
  (array['CNSHA','CNNGB'])[1 + v % 2], (array['BRSSZ','BRVIX'])[1 + v % 2],
  (array['COTTON FABRIC ROLLS','CONSUMER ELECTRONICS','STEEL COILS','SOLAR PANELS','HOUSEHOLD GOODS','AUTO PARTS'])[1 + n % 6],
  10000 + (n % 80000), 20 + (n % 150), (array['PREPAID','COLLECT'])[1 + n % 2],
  case when v > 20 then (array['paid','invoiced','paid'])[1 + n % 3] else (array['pending','invoiced','pending'])[1 + n % 3] end,
  case when v <= 4 and n % 9 = 0 then 'pending_review' else 'ok' end,
  case when n % 17 = 0 then 'carga_solta' else 'container' end,
  (152600000000000 + n)::text,
  case when v > 20 then 'ready_for_billing' else (array['calculated','ready_for_billing','review_required','not_calculated'])[1 + n % 4] end,
  case when n % 17 = 0 then null when n % 7 = 0 then 'LCL' else 'FCL' end,
  lpad((10000000 + 1 + n % 400)::text, 8, '0') || '0001' || lpad(((1 + n % 400) % 97)::text, 2, '0'),
  'CLIENTE PERF ' || (1 + n % 400),
  case when n % 23 = 0 then 'missing_customer' else 'matched_document' end,
  now() - (v * interval '3.6 days') - interval '20 days' + (n % 60) * interval '1 minute'
from generate_series(1, 200) v, lateral generate_series((v - 1) * 60 + 1, v * 60) n;

-- 2-3 containers per container BL
insert into public.bl_containers (bl_id, container_number, seal_number, type, gross_weight_kg, cbm, discharge_date, return_date, demurrage_status)
select b.id, 'PRFU' || lpad((row_number() over ())::text, 7, '0'), 'SL' || k,
  (array['40HC','20GP','40HC'])[1 + k % 3], 12000 + k * 100, 30 + k,
  (b.created_at + interval '22 days')::date,
  case when v.status = 'completed' then (b.created_at + interval '22 days' + (5 + k % 20) * interval '1 day')::date end,
  case when v.status = 'completed' then (array['returned','returned','overdue'])[1 + k % 3] else 'within_free_time' end
from public.bls b
join public.voyages v on v.id = b.voyage_id
cross join lateral generate_series(1, 2 + (hashtext(b.id) & 1)) k
where b.id like 'PERF%' and b.cargo_mode = 'container';

-- vehicles on every 4th voyage (ro-ro): 180 per voyage
insert into public.vehicles (voyage_id, bl_id, container_id, chassis, brand, model, weight_kg, cbm)
select b.voyage_id, b.id, c.id, 'LPERF' || lpad((row_number() over ())::text, 12, '0'),
  (array['BYD','Chery','GWM'])[1 + c.id % 3], (array['Song Plus','Tiggo 7','Haval H6'])[1 + c.id % 3], 1600, 12.4
from public.bls b
join public.bl_containers c on c.bl_id = b.id
cross join generate_series(1, 2) k
where b.id like 'PERF%' and b.voyage_id % 4 = 0;

insert into public.alerts (type, entity_type, entity_id, message, status, created_at)
select (array['demurrage','billing','review'])[1 + g % 3], 'bl', 'PERF' || lpad(g::text, 10, '0'),
  'Alerta perf ' || g || ': pendência operacional para acompanhar.',
  case when g < 150 then 'open' when g < 200 then 'acknowledged' else 'closed' end,
  now() - (g * interval '5 hours')
from generate_series(1, 3000) g;

insert into public.invoices (id, invoice_number, customer_id, bl_id, issued_at, total_brl, status, total_paid_brl, balance_brl, invoice_type)
select 10000 + g, 'FAT-P-' || lpad(g::text, 6, '0'), 1001 + g % 400, 'PERF' || lpad((g * 3)::text, 10, '0'),
  now() - (g * interval '4 hours'), 3005, case when g < 60 then 'issued' else 'paid' end,
  case when g < 60 then 0 else 3005 end, case when g < 60 then 3005 else 0 end, 'individual'
from generate_series(1, 4000) g;
insert into public.invoice_items (invoice_id, description, quantity, unit_value_brl, total_value_brl, bl_id, source, currency)
select i.id, d, 1, 1000, 1000, i.bl_id, 'charge_table', 'BRL'
from public.invoices i cross join unnest(array['THC — Capatazia','BL Fee — Emissão','ISPS — Segurança']) d
where i.id >= 10000;
insert into public.invoice_bls (invoice_id, bl_id, subtotal_brl)
select id, bl_id, total_brl from public.invoices where id >= 10000;
insert into public.bl_receivables (bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl, status, voyage_id, cargo_mode, pol, pod)
select i.bl_id, i.customer_id, 'local_charges', 3005, i.total_paid_brl, i.balance_brl,
  case when i.balance_brl = 0 then 'settled' else 'open' end, b.voyage_id, b.cargo_mode, b.pol, b.pod
from public.invoices i join public.bls b on b.id = i.bl_id where i.id >= 10000;

insert into public.voyage_export_schedules (voyage_id, has_granite, containers_qty, movements_qty, tem_exportacao, ce_status, linked, pol)
select 1000 + g, false, 150, 300, true, 'approved', true, (array['BRSSZ','BRVIX'])[1 + g % 2]
from generate_series(1, 200) g;

insert into public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at)
select 'bl', 'PERF' || lpad((1 + g % 12000)::text, 10, '0'), (array['review_status','customer_id','charge_status'])[1 + g % 3],
  'old', 'new', 'a0000000-0000-4000-8000-000000000001', now() - (g * interval '40 minutes')
from generate_series(1, 24000) g;

select setval('voyages_id_seq', 5000);
select setval('customers_id_seq', 5000);
select setval('invoices_id_seq', 50000);
select setval('import_batches_id_seq', 5000);
commit;
analyze;
