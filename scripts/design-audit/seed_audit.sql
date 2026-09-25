-- Synthetic audit seed (fake data only)

begin;
set local session_replication_role = replica;

-- auth user + profiles
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000001','authenticated','authenticated','auditor@local.test', extensions.crypt('audit-local', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{}', now(), now()),
       ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000002','authenticated','authenticated','operador@local.test', extensions.crypt('audit-local', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{}', now(), now());
insert into public.user_profiles (id, full_name, role, active) values
  ('a0000000-0000-4000-8000-000000000001','Ana Ribeiro','administrativo', true),
  ('a0000000-0000-4000-8000-000000000002','Carlos Mendes','operator', true);

insert into public.carriers (id, name, scac) values (50,'COSCO Shipping','COSU') on conflict do nothing;
select setval('carriers_id_seq', 60);

-- A migration 307 e dona do catalogo de portos brasileiros: BRVIX, BRRIG e os
-- demais ja existem com ids proprios quando este seed roda. Fixar id aqui e
-- ilusorio (o ON CONFLICT engole a linha) e mentiroso — por isso nenhum port_id
-- deste arquivo e numero literal; todos saem de um subselect por LOCODE.
insert into public.ports (name, locode, country)
select 'Ningbo', 'CNNGB', 'China'
where not exists (select 1 from public.ports where locode = 'CNNGB');

insert into public.vessels (id, name, imo, carrier_id) values
  (10,'COSCO SHIPPING ARIES','9783615',50),
  (11,'XIN PU DONG','9234355',50)
on conflict do nothing;
select setval('vessels_id_seq', 20);

insert into public.voyages (id, vessel_id, voyage_number, pol_id, pod_id, etd, eta, status) values
  (10, 10, '088E', (select id from ports where locode='CNSHA' order by id limit 1), (select id from ports where locode='BRSSZ' order by id limit 1), now() - interval '32 days', now() - interval '2 days', 'active'),
  (11, 11, '012S', (select id from ports where locode='CNNGB' order by id limit 1), (select id from ports where locode='BRSSZ' order by id limit 1), now() - interval '75 days', now() - interval '41 days', 'completed');
select setval('voyages_id_seq', 20);

insert into public.customers (id, cnpj_cpf, name, trade_name, city, state) values
  (101,'12.345.678/0001-90','Importadora Atlântico Ltda','Atlântico Imports','Santos','SP'),
  (102,'23.456.789/0001-01','Comercial Pacífico S.A.','Pacífico Trade','São Paulo','SP'),
  (103,'34.567.890/0001-12','Logística Horizonte Eireli','Horizonte Log','Campinas','SP'),
  (104,'45.678.901/0001-23','Grupo Meridiano Comércio Exterior','Meridiano Comex','Itajaí','SC'),
  (105,'56.789.012/0001-34','Têxtil Nova Era Ltda','Nova Era','Blumenau','SC'),
  (106,'67.890.123/0001-45','Eletro Importados do Brasil','EletroBras Imports','Guarulhos','SP'),
  (107,'78.901.234/0001-56','Máquinas Pesadas Sul Ltda','MaqSul','Porto Alegre','RS'),
  (108,'89.012.345/0001-67','Distribuidora Estrela do Mar','Estrela do Mar','Santos','SP');
select setval('customers_id_seq', 200);

insert into public.customer_contacts (customer_id, name, email, phone, is_primary) values
  (101,'Mariana Souza','financeiro@atlantico.example','(13) 3232-1010', true),
  (102,'Paulo Lima','paulo@pacifico.example','(11) 4002-8922', true),
  (103,'Renata Alves','renata@horizonte.example',null, false);

insert into public.import_batches (id, voyage_id, filename, status, cargo_mode, uploaded_at) values
  (10, 10, 'COSU_088E_manifest.xlsx', 'completed', 'container', now() - interval '20 days'),
  (11, 11, 'XPD_012S_manifest.xlsx', 'completed', 'container', now() - interval '70 days');
select setval('import_batches_id_seq', 20);

-- BLs voyage 10 (active)
insert into public.bls (id, voyage_id, batch_id, shipper, consignee, customer_id, pol, pod, cargo_description, total_weight_kg, total_cbm, payment_type, financial_status, review_status, cargo_mode, ce_mercante, charge_status, container_load_type, manifest_customer_cnpj_cpf, manifest_customer_name, customer_reconciliation_status) values
  ('COSU6401234501',10,10,'Shanghai Textile Export Co','Importadora Atlântico Ltda',101,'CNSHA','BRSSZ','COTTON FABRIC ROLLS',48500,112.5,'PREPAID','invoiced','ok','container','152605123456701','ready_for_billing','FCL','12.345.678/0001-90','IMPORTADORA ATLANTICO LTDA','matched_document'),
  ('COSU6401234502',10,10,'Ningbo Electronics Mfg','Eletro Importados do Brasil',106,'CNNGB','BRSSZ','CONSUMER ELECTRONICS',31200,87.0,'PREPAID','pending','ok','container','152605123456702','calculated','FCL','67.890.123/0001-45','ELETRO IMPORTADOS DO BRASIL','matched_document'),
  ('COSU6401234503',10,10,'Qingdao Machinery Works','Máquinas Pesadas Sul Ltda',107,'CNSHA','BRSSZ','INDUSTRIAL LATHE PARTS',62300,140.2,'COLLECT','pending','pending_review','container','152605123456703','review_required','FCL','78.901.234/0001-56','MAQUINAS PESADAS SUL','matched_name'),
  ('COSU6401234504',10,10,'Hangzhou Trade Partners','Comercial Pacífico S.A.',102,'CNSHA','BRSSZ','HOUSEHOLD GOODS',18700,55.4,'PREPAID','paid','ok','container','152605123456704','ready_for_billing','LCL','23.456.789/0001-01','COMERCIAL PACIFICO SA','matched_document'),
  ('COSU6401234505',10,10,'Shenzhen Plastics Co',null,null,'CNSHA','BRSSZ','PLASTIC RESIN PELLETS',24100,60.0,'PREPAID','pending','pending_review','container','152605123456705','not_calculated','FCL','99.888.777/0001-66','DISTRIB BRASIL COM LTDA','missing_customer'),
  ('COSU6401234506',10,10,'Tianjin Steel Export','Grupo Meridiano Comércio Exterior',104,'CNSHA','BRSSZ','STEEL COILS',95800,48.0,'COLLECT','pending','ok','container','152605123456706','calculated','FCL','45.678.901/0001-23','GRUPO MERIDIANO COMEX','matched_document'),
  ('COSU6401234507',10,10,'Guangzhou Furniture Ltd','Distribuidora Estrela do Mar',108,'CNSHA','BRSSZ','WOODEN FURNITURE KD',22000,118.9,'PREPAID','pending','ok','container','152605123456707','exempt','FCL','89.012.345/0001-67','DISTRIBUIDORA ESTRELA DO MAR','matched_document'),
  ('COSU6401234508',10,10,'Wuxi Solar Tech','Têxtil Nova Era Ltda',105,'CNNGB','BRSSZ','SOLAR PANELS',26750,73.3,'PREPAID','invoiced','ok','container','152605123456708','ready_for_billing','FCL','56.789.012/0001-34','TEXTIL NOVA ERA','matched_document'),
  ('COSU6401234509',10,10,'Dalian Heavy Industries','Máquinas Pesadas Sul Ltda',107,'CNSHA','BRSSZ','CRANE BOOM SECTIONS (BREAK BULK)',88000,210.0,'COLLECT','pending','ok','carga_solta','152605123456709','not_calculated',null,'78.901.234/0001-56','MAQUINAS PESADAS SUL LTDA','matched_document'),
  ('COSU6401234510',10,10,'Xiamen Stone Export',null,null,'CNSHA','BRVIX','GRANITE BLOCKS ROUGH',125000,80.0,'PREPAID','pending','pending_review','carga_solta','152605123456710','not_calculated',null,'11.222.333/0001-44','GRANITOS ESPIRITO SANTO','missing_customer'),
  ('XPDU5500987601',11,11,'Ningbo Garment Factory','Importadora Atlântico Ltda',101,'CNNGB','BRSSZ','KNITWEAR APPAREL',15300,44.1,'PREPAID','paid','ok','container','152604987600001','ready_for_billing','FCL','12.345.678/0001-90','IMPORTADORA ATLANTICO','matched_document'),
  ('XPDU5500987602',11,11,'Shanghai Toys Co','Comercial Pacífico S.A.',102,'CNSHA','BRSSZ','TOYS AND GAMES',12800,39.7,'PREPAID','paid','ok','container','152604987600002','ready_for_billing','FCL','23.456.789/0001-01','COMERCIAL PACIFICO','matched_document');

-- containers
insert into public.bl_containers (bl_id, container_number, seal_number, type, gross_weight_kg, cbm, discharge_date, return_date, demurrage_status) values
  ('COSU6401234501','CSNU6012301','SL88101','40HC',24250,56.2, current_date - 2, null, 'within_free_time'),
  ('COSU6401234501','CSNU6012302','SL88102','40HC',24250,56.3, current_date - 2, null, 'within_free_time'),
  ('COSU6401234502','CSNU6012303','SL88103','40HC',15600,43.5, current_date - 2, null, 'within_free_time'),
  ('COSU6401234502','CSNU6012304','SL88104','40HC',15600,43.5, current_date - 2, null, 'within_free_time'),
  ('COSU6401234503','CSNU6012305','SL88105','20GP',31150,70.1, current_date - 2, null, 'within_free_time'),
  ('COSU6401234503','CSNU6012306','SL88106','20GP',31150,70.1, current_date - 2, null, 'within_free_time'),
  ('COSU6401234504','CSNU6012307','SL88107','40HC',18700,55.4, current_date - 2, null, 'within_free_time'),
  ('COSU6401234505','CSNU6012308','SL88108','20GP',24100,60.0, current_date - 2, null, 'within_free_time'),
  ('COSU6401234506','CSNU6012309','SL88109','20GP',47900,24.0, current_date - 2, null, 'within_free_time'),
  ('COSU6401234506','CSNU6012310','SL88110','20GP',47900,24.0, current_date - 2, null, 'within_free_time'),
  ('COSU6401234507','CSNU6012311','SL88111','40HC',11000,59.4, current_date - 2, null, 'within_free_time'),
  ('COSU6401234507','CSNU6012312','SL88112','40HC',11000,59.5, current_date - 2, null, 'within_free_time'),
  ('COSU6401234508','CSNU6012313','SL88113','40HC',26750,73.3, current_date - 2, null, 'within_free_time'),
  ('XPDU5500987601','XPDU4400101','XP77001','40HC',15300,44.1, current_date - 45, current_date - 30, 'returned'),
  ('XPDU5500987602','XPDU4400102','XP77002','20GP',12800,39.7, current_date - 45, current_date - 18, 'overdue'),
  ('XPDU5500987602','XPDU4400103','XP77003','20GP',12800,39.7, current_date - 45, null, 'overdue');

-- vehicles (ro-ro voyage 10)
insert into public.vehicles (voyage_id, bl_id, container_id, chassis, brand, model, weight_kg, cbm)
select 10, 'COSU6401234506', c.id, v.chassis, v.brand, v.model, v.weight_kg, v.cbm
from (values
  ('LSGWA96X1NS100001','Chery','Tiggo 7 Pro',1620,12.4,'CSNU6012309'),
  ('LSGWA96X1NS100002','Chery','Tiggo 7 Pro',1620,12.4,'CSNU6012309'),
  ('LSGWA96X1NS100003','Chery','Tiggo 8',1755,13.1,'CSNU6012309'),
  ('LGXC76C40N0100004','BYD','Song Plus',1850,12.9,'CSNU6012310'),
  ('LGXC76C40N0100005','BYD','Song Plus',1850,12.9,'CSNU6012310'),
  ('LGXC76C40N0100006','BYD','Dolphin',1405,10.7,'CSNU6012310')
) as v(chassis, brand, model, weight_kg, cbm, cn)
join public.bl_containers c on c.container_number = v.cn;

-- charge table
insert into public.charge_tables (id, name, pod, carrier_id, valid_from, valid_to, active, cargo_mode) values
  (10,'Tabela Santos 2026 — COSCO','BRSSZ',50,'2026-01-01','2026-12-31', true,'container');
select setval('charge_tables_id_seq', 20);
insert into public.charge_table_items (charge_table_id, name, applies_to, container_type, cargo_profile, value_brl, currency, category, application_basis, unit_value_brl, active, sort_order) values
  (10,'THC — Capatazia','container','any','standard',1250.00,'BRL','base','container_distinct_voyage',1250.00,true,1),
  (10,'BL Fee — Emissão','bl',null,'any',450.00,'BRL','base','bl',450.00,true,2),
  (10,'ISPS — Segurança','container','any','any',55.00,'BRL','base','container_distinct_voyage',55.00,true,3),
  (10,'Logística OOG','container','any','oog',2100.00,'BRL','other_charge','container_distinct_voyage',2100.00,true,4);

insert into public.demurrage_rates (container_type, free_days, p1_day_from, p1_day_to, p1_usd, p2_day_from, p2_usd, valid_from, active) values
  ('20GP',10,1,10,95.00,11,190.00,'2026-01-01',true),
  ('40HC',10,1,10,120.00,11,240.00,'2026-01-01',true);

-- invoices
-- Taxa local não tem vencimento praticado (ADR 0055): sem due_date, sem 'overdue'.
insert into public.invoices (id, invoice_number, customer_id, bl_id, issued_at, total_brl, status, total_paid_brl, balance_brl, invoice_type, pix_txid) values
  (201,'FAT-2026-0018',101,'COSU6401234501', now() - interval '6 days',  3005.00,'issued',0,3005.00,'individual','TXN2026AUD001'),
  (202,'FAT-2026-0017',105,'COSU6401234508', now() - interval '8 days',  1755.00,'issued',0,1755.00,'individual','TXN2026AUD002'),
  (203,'FAT-2026-0016',102,'COSU6401234504', now() - interval '20 days', 1805.00,'issued',0,1805.00,'individual','TXN2026AUD003'),
  (204,'FAT-2026-0015',101,'XPDU5500987601', now() - interval '38 days', 2555.00,'paid',2555.00,0,'individual',null),
  (205,'FAT-2026-0014',102,'XPDU5500987602', now() - interval '40 days', 3010.00,'partially_paid',1500.00,1510.00,'individual','TXN2026AUD005'),
  (206,'FAT-2026-0013',104,null,             now() - interval '45 days', 5320.00,'cancelled',0,5320.00,'consolidated',null);
select setval('invoices_id_seq', 300);

insert into public.invoice_items (invoice_id, description, quantity, unit_value_brl, total_value_brl, bl_id, source, currency) values
  (201,'THC — Capatazia (2 x 40HC)',2,1250.00,2500.00,'COSU6401234501','charge_table','BRL'),
  (201,'BL Fee — Emissão',1,450.00,450.00,'COSU6401234501','charge_table','BRL'),
  (201,'ISPS — Segurança',1,55.00,55.00,'COSU6401234501','charge_table','BRL'),
  (202,'THC — Capatazia (1 x 40HC)',1,1250.00,1250.00,'COSU6401234508','charge_table','BRL'),
  (202,'BL Fee — Emissão',1,450.00,450.00,'COSU6401234508','charge_table','BRL'),
  (202,'ISPS — Segurança',1,55.00,55.00,'COSU6401234508','charge_table','BRL'),
  (203,'THC — Capatazia (1 x 40HC)',1,1250.00,1250.00,'COSU6401234504','charge_table','BRL'),
  (203,'BL Fee — Emissão',1,450.00,450.00,'COSU6401234504','charge_table','BRL'),
  (203,'Despacho LCL',1,105.00,105.00,'COSU6401234504','manual','BRL'),
  (204,'Taxas locais consolidadas',1,2555.00,2555.00,'XPDU5500987601','charge_table','BRL'),
  (205,'Taxas locais consolidadas',1,3010.00,3010.00,'XPDU5500987602','charge_table','BRL');

insert into public.invoice_bls (invoice_id, bl_id, subtotal_brl) values
  (201,'COSU6401234501',3005.00),(202,'COSU6401234508',1755.00),(203,'COSU6401234504',1805.00),(204,'XPDU5500987601',2555.00),(205,'XPDU5500987602',3010.00);

insert into public.bl_receivables (bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl, status, voyage_id, cargo_mode, pol, pod) values
  ('COSU6401234501',101,'local_charges',3005.00,0,3005.00,'open',10,'container','CNSHA','BRSSZ'),
  ('COSU6401234508',105,'local_charges',1755.00,0,1755.00,'open',10,'container','CNNGB','BRSSZ'),
  ('COSU6401234504',102,'local_charges',1805.00,0,1805.00,'open',10,'container','CNSHA','BRSSZ'),
  ('XPDU5500987601',101,'local_charges',2555.00,2555.00,0,'settled',11,'container','CNNGB','BRSSZ'),
  ('XPDU5500987602',102,'local_charges',3010.00,1500.00,1510.00,'partially_settled',11,'container','CNSHA','BRSSZ');

insert into public.customer_reconciliation_queue (bl_id, customer_id, cnpj_cpf, manifest_customer_name, manifest_customer_email, detection_type, status) values
  ('COSU6401234505',null,'99.888.777/0001-66','DISTRIB BRASIL COM LTDA','fiscal@distribbrasil.example','missing','pending'),
  ('COSU6401234510',null,'11.222.333/0001-44','GRANITOS ESPIRITO SANTO',null,'missing','pending'),
  ('COSU6401234503',107,'78.901.234/0001-56','MAQUINAS PESADAS SUL','compras@maqsul.example','name','pending');

insert into public.alerts (type, entity_type, entity_id, message, status) values
  ('demurrage','container','XPDU4400103','Container XPDU4400103 excedeu o free time há 35 dias e não retornou.','open'),
  ('billing','invoice','FAT-2026-0016','Fatura FAT-2026-0016 vencida há 4 dias sem pagamento registrado.','open'),
  ('review','bl','COSU6401234505','B/L COSU6401234505 sem cliente vinculado após importação do manifesto.','acknowledged');

-- ETA/ETB sairam de voyage_export_schedules quando a Escala passou a ser dona
-- da chegada ao porto e a Atracacao das datas de berco.
insert into public.voyage_export_schedules (voyage_id, has_granite, containers_qty, movements_qty, tem_exportacao, ce_status, linked, pol) values
  (10, false, 13, 26, true, 'launching', true, 'BRVIX'),
  (11, false, 3, 6, true, 'approved', true, 'CNNGB'),
  (1, false, 0, 0, false, 'waiting', true, 'CNSHA');

-- ---------------------------------------------------------------------------
-- Escala BRVIX da viagem 10 com DUAS Atracacoes (TVV e PORTMAC).
-- Reproduz o cenario que a revisao de Atracacoes usa: o TVV ja desatracou,
-- a Portmac nao — entao o ATD derivado da Escala ainda nao existe.
-- ---------------------------------------------------------------------------

insert into public.depots (id, code, name, tipo, port_id, active, free_time_vazio_days, free_time_material_days) values
  ('d0000000-0000-4000-8000-000000000001','TVV','Terminal de Vila Velha','terminal_portuario', (select id from public.ports where locode = 'BRVIX' order by id limit 1), true, 0, 0),
  ('d0000000-0000-4000-8000-000000000002','PORTMAC','Porto de Praia Mole','terminal_portuario', (select id from public.ports where locode = 'BRVIX' order by id limit 1), true, 0, 0),
  ('d0000000-0000-4000-8000-000000000003','FLUMAR','Depot Flumar','depot', null, true, 7, 5)
on conflict do nothing;

-- A Escala e dona de ETA e ATA, gravadas na trilha de auditoria.
insert into public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at) values
  ('voyage_pod_schedule','10::BRVIX','eta',  null, to_char(current_date - 6, 'YYYY-MM-DD'), 'a0000000-0000-4000-8000-000000000001', now() - interval '9 days'),
  ('voyage_pod_schedule','10::BRVIX','ata',  null, to_char(current_date - 6, 'YYYY-MM-DD'), 'a0000000-0000-4000-8000-000000000001', now() - interval '6 days'),
  ('voyage_pod_schedule','10::BRVIX','ces',  null, 'launching', 'a0000000-0000-4000-8000-000000000001', now() - interval '6 days'),
  ('voyage_pod_schedule','10::BRVIX','linked', null, 'true', 'a0000000-0000-4000-8000-000000000001', now() - interval '6 days'),
  ('voyage_pod_schedule','10::BRVIX','escala_number', null, '2026/000481', 'a0000000-0000-4000-8000-000000000001', now() - interval '6 days'),
  ('voyage_pod_schedule','10::BRVIX','tem_importacao', null, 'true', 'a0000000-0000-4000-8000-000000000001', now() - interval '9 days');

insert into public.voyage_escala_revision_state (voyage_id, port, port_id, revision)
values (10, 'BRVIX', (select id from public.ports where locode = 'BRVIX' order by id limit 1), 3)
on conflict do nothing;

-- Atracacoes: uma por terminal. A ordem nunca e digitada — deriva de
-- COALESCE(ATB, ETB), com empate desfeito pelo codigo do terminal.
insert into public.voyage_escala_terminal_state
  (voyage_id, port, port_id, terminal_id, terminal_etb, terminal_atb, terminal_etd, terminal_atd, terminal_rtw, revision) values
  (10, 'BRVIX', (select id from public.ports where locode = 'BRVIX' order by id limit 1), 'd0000000-0000-4000-8000-000000000001', current_date - 5, current_date - 5, current_date - 3, current_date - 2, 4, 3),
  (10, 'BRVIX', (select id from public.ports where locode = 'BRVIX' order by id limit 1), 'd0000000-0000-4000-8000-000000000002', current_date - 3, current_date - 2, current_date + 1, null, null, 3)
on conflict do nothing;

-- Frentes: varias frentes no mesmo terminal dividem um ADR.
insert into public.voyage_escala_operation_fronts
  (voyage_id, port, port_id, sentido, modalidade, terminal_id, source, revision) values
  (10, 'BRVIX', (select id from public.ports where locode = 'BRVIX' order by id limit 1), 'importacao', 'carga_cheia', 'd0000000-0000-4000-8000-000000000001', 'operational_data', 3),
  (10, 'BRVIX', (select id from public.ports where locode = 'BRVIX' order by id limit 1), 'importacao', 'vazio',       'd0000000-0000-4000-8000-000000000001', 'operational_data', 3),
  (10, 'BRVIX', (select id from public.ports where locode = 'BRVIX' order by id limit 1), 'importacao', 'veiculo',     'd0000000-0000-4000-8000-000000000001', 'operational_data', 3),
  (10, 'BRVIX', (select id from public.ports where locode = 'BRVIX' order by id limit 1), 'exportacao', 'vazio',       'd0000000-0000-4000-8000-000000000002', 'export_declaration', 3)
on conflict do nothing;

-- Um ADR por terminal, com fechamento independente.
insert into public.agency_departure_reports (voyage_id, port, terminal, terminal_id, terminal_port_id, status) values
  (10, 'BRVIX', 'Terminal de Vila Velha', 'd0000000-0000-4000-8000-000000000001', (select id from public.ports where locode = 'BRVIX' order by id limit 1), 'open'),
  (10, 'BRVIX', 'Porto de Praia Mole',    'd0000000-0000-4000-8000-000000000002', (select id from public.ports where locode = 'BRVIX' order by id limit 1), 'open')
on conflict do nothing;

commit;
