-- Somente Postgres descartável. Fixtures e configurações são revertidas.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'vela_test' OR inet_server_addr() IS NOT NULL AND inet_server_addr() NOT IN ('127.0.0.1'::inet,'::1'::inet) THEN
    RAISE EXCEPTION 'Use somente o banco vela_test no Postgres local descartável.';
  END IF;
END; $$;
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
DO $$
DECLARE
  v_actor uuid := '00000000-0000-0000-0000-000000114001';
  v_dem uuid; v_local uuid; v_cancel uuid; v_recover uuid; v_txid text; v_original text;
  v_value numeric; v_at timestamptz := '2026-10-02 10:00:00-03'; v_result jsonb;
  v_manual bigint; v_manual_charge uuid; v_alert_charge uuid; v_over uuid;
BEGIN
  IF (SELECT enabled FROM public.pix_simulation_settings) THEN RAISE EXCEPTION 'Teste exige simulação inicialmente desativada.'; END IF;
  -- Calendário 2026 real: sexta 20/11 (Consciência Negra) empurra quinta 19/11 para segunda 23/11;
  -- ponto facultativo 30/10 não empurra quinta 29/10.
  UPDATE public.pix_simulation_settings SET enabled=true;
  IF public.pix_simulation_cutoff('2026-11-19 10:00-03') IS DISTINCT FROM '2026-11-23 14:30:00-03'::timestamptz
    OR public.pix_simulation_cutoff('2026-10-29 10:00-03') IS DISTINCT FROM '2026-10-30 14:30:00-03'::timestamptz THEN RAISE EXCEPTION 'Calendário 2026 aplicado incorretamente.'; END IF;
  UPDATE public.pix_simulation_settings SET enabled=false;
  BEGIN PERFORM public.run_pix_simulation(v_at); RAISE EXCEPTION 'Modo desligado aceitou execução.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  INSERT INTO auth.users(id,email) VALUES(v_actor,'pix-simulation@example.test');
  INSERT INTO public.user_profiles(id,full_name,role) VALUES(v_actor,'Administrador da simulação','administrativo');
  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  INSERT INTO public.customers(id,cnpj_cpf,name) VALUES(99114001,'11222333000181','Cliente Pix simulado');
  INSERT INTO public.carriers(id,name) VALUES(99114001,'Simulado');
  INSERT INTO public.vessels(id,name,carrier_id) VALUES(99114001,'Simulado',99114001);
  INSERT INTO public.voyages(id,vessel_id,voyage_number,status) VALUES(99114001,99114001,'PIX-SIM','active');
  INSERT INTO public.bls(id,voyage_id,customer_id,cargo_mode,ce_mercante)
    VALUES('PIX-SIM-DEM',99114001,99114001,'container','991140000000001'),('PIX-SIM-LOCAL',99114001,99114001,'container','991140000000001'),
      ('PIX-SIM-RECOVER',99114001,99114001,'container','991140000000002');
  INSERT INTO public.demurrage_invoices(id,doc_number,bl_id,customer_id,total_usd,current_roe,current_total_brl,status,roe_source)
    VALUES(99114001,'SIM-DEM','PIX-SIM-DEM',99114001,100,5.5,550,'issued','manual');
  INSERT INTO public.demurrage_invoice_history(invoice_id,event_date,ptax_used,roe_used,total_usd,total_brl,discount_usd,source)
    VALUES(99114001,'2026-10-02',5.1643,5.5,100,550,0,'manual');
  INSERT INTO public.invoices(id,invoice_number,customer_id,total_brl,balance_brl,status)
    VALUES(99114001,'SIM-LOCAL',99114001,100,100,'issued'),(99114002,'SIM-CANCEL',99114001,100,100,'issued'),
      (99114003,'SIM-RECOVER',99114001,100,100,'issued');
  INSERT INTO public.bl_receivables(id,bl_id,customer_id,original_amount_brl,balance_brl)
    VALUES(99114001,'PIX-SIM-LOCAL',99114001,100,100),(99114003,'PIX-SIM-RECOVER',99114001,100,100);
  INSERT INTO public.invoice_receivable_links(invoice_id,receivable_id,bl_id,subtotal_brl)
    VALUES(99114001,99114001,'PIX-SIM-LOCAL',100),(99114003,99114003,'PIX-SIM-RECOVER',100);
  UPDATE public.pix_simulation_settings SET enabled=true, calendar_years=ARRAY[2026], holidays=ARRAY['2026-10-05'::date];
  -- Segunda-feira marcada como feriado SINTÉTICO, não calendário oficial.
  IF public.pix_simulation_cutoff(v_at) IS DISTINCT FROM '2026-10-06 14:30:00-03'::timestamptz THEN RAISE EXCEPTION 'Fim de semana/feriado calculado incorretamente.'; END IF;
  BEGIN PERFORM public.pix_simulation_cutoff('2026-12-31 10:00-03'); RAISE EXCEPTION 'Calendário ausente foi aceito.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_dem := public.enroll_pix_simulation('demurrage',99114001,v_actor,v_at);
  IF public.enroll_pix_simulation('demurrage',99114001,v_actor,v_at) <> v_dem THEN RAISE EXCEPTION 'Emissão duplicou cobrança.'; END IF;
  v_local := public.enroll_pix_simulation('local',99114001,v_actor,v_at);
  v_cancel := public.enroll_pix_simulation('local',99114002,v_actor,v_at);
  v_recover := public.enroll_pix_simulation('local',99114003,v_actor,v_at);
  PERFORM public.run_pix_simulation(v_at);
  IF EXISTS(SELECT 1 FROM public.pix_charges WHERE state <> 'active') THEN RAISE EXCEPTION 'Emissão não confirmou.'; END IF;
  IF public._portal_get_demurrage_invoice_detail_core(99114001,99114001)->'invoice'->>'pix_integration_state' IS DISTINCT FROM 'simulation:active' THEN RAISE EXCEPTION 'Estado Pix não chegou ao detalhe Portal.'; END IF;
  IF EXISTS(SELECT 1 FROM public.invoices WHERE id BETWEEN 99114001 AND 99114003 AND pix_payload IS NOT NULL) THEN RAISE EXCEPTION 'Simulação expôs QR pagável.'; END IF;
  SELECT txid INTO v_original FROM public.pix_charges WHERE id=v_dem;
  PERFORM public.recalculate_demurrage_invoices(5.6338,'2026-10-02','manual');
  PERFORM public.run_pix_simulation(v_at + interval '1 hour');
  IF NOT EXISTS(SELECT 1 FROM public.pix_charges WHERE id=v_dem AND txid=v_original AND revision=1 AND amount_brl=600) THEN RAISE EXCEPTION 'Revisão mudou TXID ou falhou.'; END IF;
  -- Releitura do QR aponta para revisão atual; pagamento iniciado antes do
  -- próximo PATCH conserva os 600, mesmo que a fatura já esteja em 650.
  PERFORM public.recalculate_demurrage_invoices(6.1033,'2026-10-02','manual');
  PERFORM public.recalculate_demurrage_invoices(6.5728,'2026-10-02','manual');
  PERFORM public.pay_pix_simulation(v_original,'E-SIM-DEM',v_at + interval '2 hours');
  PERFORM public.run_pix_simulation(v_at + interval '2 hours');
  SELECT current_total_brl INTO v_value FROM public.demurrage_invoices WHERE id=99114001 AND status='paid';
  IF v_value IS DISTINCT FROM 600 THEN RAISE EXCEPTION 'Revisão anterior não quitou: %.',v_value; END IF;
  IF current_setting('request.jwt.claim.role') <> 'service_role' THEN RAISE EXCEPTION 'Contexto financeiro vazou.'; END IF;
  PERFORM public.run_pix_simulation(v_at + interval '2 hours');
  IF (SELECT count(*) FROM public.demurrage_invoice_history WHERE invoice_id=99114001 AND source='payment') <> 1 THEN RAISE EXCEPTION 'Baixa duplicada.'; END IF;
  SELECT txid INTO v_txid FROM public.pix_charges WHERE id=v_local;
  PERFORM public.pay_pix_simulation(v_txid,'E-SIM-LOCAL',v_at + interval '3 hours');
  PERFORM public.pay_pix_simulation(v_txid,'E-SIM-LOCAL',v_at + interval '3 hours');
  PERFORM public.run_pix_simulation(v_at + interval '3 hours');
  IF NOT EXISTS(SELECT 1 FROM public.invoices WHERE id=99114001 AND status='paid' AND balance_brl=0) THEN RAISE EXCEPTION 'Recebimento não quitou ledger local.'; END IF;
  IF (SELECT count(*) FROM public.ledger_settlements WHERE invoice_id=99114001) <> 1 THEN RAISE EXCEPTION 'Conciliação duplicada.'; END IF;
  UPDATE public.invoices SET status='cancelled' WHERE id=99114002;
  UPDATE public.pix_charges SET fail_next=true WHERE id=v_cancel;
  PERFORM public.run_pix_simulation(v_at + interval '4 hours');
  IF NOT EXISTS(SELECT 1 FROM public.pix_charges WHERE id=v_cancel AND state='cancel_pending' AND attempts=1) THEN RAISE EXCEPTION 'Falha não preservou cancelamento pendente.'; END IF;
  SELECT txid INTO v_txid FROM public.pix_charges WHERE id=v_cancel;
  PERFORM public.pay_pix_simulation(v_txid,'E-SIM-CANCEL',v_at + interval '4 hours');
  PERFORM public.run_pix_simulation(v_at + interval '4 hours');
  IF NOT EXISTS(SELECT 1 FROM public.pix_receipts WHERE end_to_end_id='E-SIM-CANCEL' AND state='review') THEN RAISE EXCEPTION 'Corrida de cancelamento perdeu recebimento.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.invoices WHERE id=99114002 AND status='cancelled') THEN RAISE EXCEPTION 'Recebimento reabriu fatura cancelada.'; END IF;
  UPDATE public.pix_simulation_settings SET extend_expired=false;
  PERFORM public.run_pix_simulation(v_at + interval '25 hours');
  IF NOT EXISTS(SELECT 1 FROM public.pix_charges WHERE predecessor_id=v_recover AND state='active') THEN RAISE EXCEPTION 'Recuperação não emitiu nova cobrança na mesma execução.'; END IF;
  SELECT txid INTO v_txid FROM public.pix_charges WHERE id=v_recover;
  BEGIN PERFORM public.pay_pix_simulation(v_txid,'E-EXPIRED',v_at + interval '25 hours'); RAISE EXCEPTION 'COB expirada aceitou pagamento.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM public.run_pix_simulation(v_at + interval '25 hours');
  IF (SELECT count(*) FROM public.pix_charges WHERE process_key='local:99114003' AND state='active') <> 1 THEN RAISE EXCEPTION 'Recuperação deixou múltiplas cobranças.'; END IF;
  UPDATE public.pix_simulation_settings SET extend_expired=true;
  PERFORM public.run_pix_simulation(v_at + interval '48 hours' + interval '58 minutes');
  IF (SELECT count(*) FROM public.pix_charges WHERE process_key='local:99114003') <> 2 THEN RAISE EXCEPTION 'Renovação criou TXID extra.'; END IF;
  -- Notificação tardia do TXID antigo: pagamento feito antes de expirar.
  SELECT txid INTO v_original FROM public.pix_charges WHERE id=v_recover;
  PERFORM public.import_pix_simulated_receipt(v_original,0,'E-LATE',v_at + interval '1 hour');
  PERFORM public.run_pix_simulation(v_at + interval '49 hours');
  PERFORM public.run_pix_simulation(v_at + interval '49 hours');
  IF NOT EXISTS(SELECT 1 FROM public.invoices WHERE id=99114003 AND status='paid' AND pix_txid=v_original) THEN RAISE EXCEPTION 'Recebimento tardio não quitou com TXID antigo.'; END IF;
  IF EXISTS(SELECT 1 FROM public.pix_charges WHERE process_key='local:99114003' AND state IN ('active','cancel_pending','pending')) THEN RAISE EXCEPTION 'Recebimento tardio deixou recuperação pagável.'; END IF;
  -- Emissão e cancelamento pelos mesmos RPCs usados nas telas do Vela.
  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  v_result := public.create_manual_invoice(99114001,'Teste Pix',1,100,NULL,NULL,NULL,v_actor);
  v_manual := (v_result->>'invoice_id')::bigint;
  v_manual_charge := public.enroll_pix_simulation('local',v_manual,v_actor,v_at + interval '49 hours');
  PERFORM public.run_pix_simulation(v_at + interval '49 hours');
  IF public.list_invoice_details(v_manual)->'invoice'->>'pix_integration_state' IS DISTINCT FROM 'simulation:active' THEN RAISE EXCEPTION 'Detalhe do Vela não recebeu estado Pix.'; END IF;
  PERFORM public.cancel_invoice(v_manual,'Cancelamento de teste Pix',v_actor);
  PERFORM public.run_pix_simulation(v_at + interval '49 hours');
  IF NOT EXISTS(SELECT 1 FROM public.pix_charges WHERE id=v_manual_charge AND state='cancelled') THEN RAISE EXCEPTION 'Cancelamento não confirmou.'; END IF;
  SELECT txid INTO v_txid FROM public.pix_charges WHERE id=v_manual_charge;
  BEGIN PERFORM public.pay_pix_simulation(v_txid,'E-CANCELLED',v_at + interval '49 hours'); RAISE EXCEPTION 'COB cancelada aceitou pagamento.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  INSERT INTO public.bls(id,voyage_id,customer_id,cargo_mode,ce_mercante) VALUES('PIX-SIM-ALERT',99114001,99114001,'container','991140000000003');
  INSERT INTO public.demurrage_invoices(id,doc_number,bl_id,customer_id,total_usd,current_roe,current_total_brl,status,roe_source)
    VALUES(99114002,'SIM-ALERT','PIX-SIM-ALERT',99114001,100,5.5,550,'issued','manual');
  v_alert_charge := public.enroll_pix_simulation('demurrage',99114002,v_actor,v_at + interval '72 hours');
  PERFORM public.run_pix_simulation(v_at + interval '72 hours');
  UPDATE public.demurrage_invoices SET current_roe=6,current_total_brl=600 WHERE id=99114002;
  UPDATE public.pix_charges SET fail_next=true WHERE id=v_alert_charge;
  PERFORM public.run_pix_simulation(v_at + interval '76 hours');
  IF NOT EXISTS(SELECT 1 FROM public.alert_items WHERE item_type='pix_ptax_pending' AND status='active') THEN RAISE EXCEPTION 'PTAX pendente às 14h não gerou Alerta.'; END IF;
  -- Resposta incerta vai para o Administrativo, que abre a Conciliação PIX.
  IF NOT EXISTS(SELECT 1 FROM public.alert_items i JOIN public.alerts a ON a.id=i.alert_id WHERE i.item_type='pix_review'
      AND a.entity_id=v_alert_charge::text AND i.status='active' AND i.department='administrativo') THEN RAISE EXCEPTION 'Falha incerta não gerou Alerta ao Administrativo.'; END IF;
  PERFORM public.run_pix_simulation(v_at + interval '76 hours' + interval '5 minutes');
  IF EXISTS(SELECT 1 FROM public.alert_items WHERE item_type='pix_ptax_pending' AND status='active') THEN RAISE EXCEPTION 'Alerta não resolveu após confirmação.'; END IF;
  IF EXISTS(SELECT 1 FROM public.alert_items i JOIN public.alerts a ON a.id=i.alert_id WHERE i.item_type='pix_review'
      AND a.entity_id=v_alert_charge::text AND i.status='active') THEN RAISE EXCEPTION 'Alerta de falha não resolveu após reprocessar.'; END IF;
  PERFORM public.run_pix_simulation('2026-10-06 14:30:00-03');
  SELECT txid INTO v_txid FROM public.pix_charges WHERE id=v_alert_charge;
  BEGIN PERFORM public.pay_pix_simulation(v_txid,'E-CUTOFF','2026-10-06 14:30:00-03'); RAISE EXCEPTION 'Corte das 14h30 aceitou pagamento.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF NOT EXISTS(SELECT 1 FROM public.demurrage_invoices WHERE id=99114002 AND status='issued') THEN RAISE EXCEPTION 'Expiração alterou status financeiro.'; END IF;
  -- Após o corte, a mesma fatura recebe nova cobrança com o valor vigente.
  IF NOT EXISTS(SELECT 1 FROM public.pix_charges WHERE predecessor_id=v_alert_charge AND demurrage_invoice_id=99114002
      AND state='active' AND amount_brl=600 AND expires_at='2026-10-07 14:30:00-03' AND txid<>v_txid) THEN RAISE EXCEPTION 'Corte não emitiu nova cobrança na mesma fatura.'; END IF;
  IF (SELECT pix_integration_state FROM public.demurrage_invoices WHERE id=99114002) IS DISTINCT FROM 'simulation:active' THEN RAISE EXCEPTION 'Fatura ficou sem cobrança ativa após o corte.'; END IF;
  -- Pix pago acima do saldo (baixa parcial manual antes da revisão): análise, não repetição.
  INSERT INTO public.bls(id,voyage_id,customer_id,cargo_mode,ce_mercante) VALUES('PIX-SIM-OVER',99114001,99114001,'container','991140000000004');
  INSERT INTO public.invoices(id,invoice_number,customer_id,total_brl,balance_brl,status) VALUES(99114004,'SIM-OVER',99114001,100,100,'issued');
  INSERT INTO public.bl_receivables(id,bl_id,customer_id,original_amount_brl,balance_brl) VALUES(99114004,'PIX-SIM-OVER',99114001,100,100);
  INSERT INTO public.invoice_receivable_links(invoice_id,receivable_id,bl_id,subtotal_brl) VALUES(99114004,99114004,'PIX-SIM-OVER',100);
  v_over := public.enroll_pix_simulation('local',99114004,v_actor,'2026-10-06 15:00:00-03');
  PERFORM public.run_pix_simulation('2026-10-06 15:00:00-03');
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM public.register_ledger_invoice_payment(99114004,30,'ted','2026-10-06 15:01:00-03',NULL,'manual','Parcial de teste',v_actor,gen_random_uuid());
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SELECT txid INTO v_txid FROM public.pix_charges WHERE id=v_over;
  PERFORM public.pay_pix_simulation(v_txid,'E-SIM-OVER','2026-10-06 15:02:00-03');
  PERFORM public.run_pix_simulation('2026-10-06 15:05:00-03');
  IF current_setting('request.jwt.claim.role') <> 'service_role' THEN RAISE EXCEPTION 'Contexto financeiro vazou após recusa.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pix_receipts WHERE end_to_end_id='E-SIM-OVER' AND state='review')
    OR NOT EXISTS(SELECT 1 FROM public.pix_charges WHERE id=v_over AND state='review') THEN RAISE EXCEPTION 'Recebimento acima do saldo ficou pendente.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.invoices WHERE id=99114004 AND status='partially_paid' AND balance_brl=70) THEN RAISE EXCEPTION 'Recusa alterou a baixa parcial.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.alert_items i JOIN public.alerts a ON a.id=i.alert_id WHERE i.item_type='pix_review'
      AND a.entity_id=v_over::text AND i.status='active') THEN RAISE EXCEPTION 'Recebimento em análise sem Alerta.'; END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM public.register_ledger_invoice_payment(99114004,70,'ted','2026-10-06 15:10:00-03',NULL,'manual','Quitação de teste',v_actor,gen_random_uuid());
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  IF NOT EXISTS(SELECT 1 FROM public.pix_charges WHERE id=v_over AND state='review') THEN RAISE EXCEPTION 'Quitação manual descartou a análise.'; END IF;
  IF has_table_privilege('authenticated','public.pix_receipts','INSERT') OR has_function_privilege('authenticated','public.run_pix_simulation(timestamptz)','EXECUTE')
    OR has_function_privilege('authenticated','public.import_pix_simulated_receipt(text,integer,text,timestamptz)','EXECUTE')
    OR has_function_privilege('anon','public.pay_pix_simulation(text,text,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'Backend exposto ao navegador.'; END IF;
  RAISE NOTICE 'Pix: emissão, revisão, ledger, quitação, cancelamento concorrente, recuperação, renovação e ACL aprovados.';
END;
$$;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN PERFORM public.run_pix_simulation(); RAISE EXCEPTION 'Navegador executou processador.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM count(*) FROM public.pix_charges; RAISE EXCEPTION 'Navegador leu dados privados.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
RESET ROLE;
ROLLBACK;
