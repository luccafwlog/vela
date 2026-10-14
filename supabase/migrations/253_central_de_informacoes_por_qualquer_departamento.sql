-- Item 26 (P8) do plano 2026-10-14: qualquer Departamento ativo mantém a
-- Central de Informações do Portal, em todos os tipos (depot, agente,
-- contato e rastreio do armador), com o rastro em audit_logs (ADR 0085, D7).
-- Só redefine a função; não reescreve nem apaga linhas.

CREATE OR REPLACE FUNCTION public.internal_save_portal_information(p_kind text, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_ports text[]; v_emails text[]; v_phones text[]; v_id uuid; v_before jsonb; v_key text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão para alterar informações.' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT public.normalize_port_code(value)) FILTER (WHERE btrim(value)<>''),'{}'::text[]) INTO v_ports FROM jsonb_array_elements_text(COALESCE(p_data->'ports','[]'));
  SELECT COALESCE(array_agg(btrim(value)) FILTER (WHERE btrim(value)<>''),'{}'::text[]) INTO v_emails FROM jsonb_array_elements_text(COALESCE(p_data->'emails','[]'));
  SELECT COALESCE(array_agg(btrim(value)) FILTER (WHERE btrim(value)<>''),'{}'::text[]) INTO v_phones FROM jsonb_array_elements_text(COALESCE(p_data->'phones','[]'));
  IF EXISTS (SELECT 1 FROM unnest(v_ports) p WHERE p !~ '^BR[A-Z0-9]{3}$') THEN RAISE EXCEPTION 'Informe portos brasileiros pelo código LOCODE.' USING ERRCODE='22023'; END IF;
  CASE p_kind
    WHEN 'depot' THEN
      v_id:=(p_data->>'id')::uuid; v_key:=v_id::text;
      IF NOT EXISTS (SELECT 1 FROM public.depots WHERE id=v_id AND tipo='depot') THEN RAISE EXCEPTION 'Depot inexistente.' USING ERRCODE='22023'; END IF;
      SELECT to_jsonb(i) INTO v_before FROM public.depot_portal_information i WHERE depot_id=v_id;
      INSERT INTO public.depot_portal_information(depot_id,ports,address,opening_hours,emails,phones,scheduling_url,instructions,restrictions,published)
      VALUES(v_id,v_ports,COALESCE(p_data->>'address',''),COALESCE(p_data->>'opening_hours',''),v_emails,v_phones,NULLIF(btrim(p_data->>'scheduling_url'),''),COALESCE(p_data->>'instructions',''),COALESCE(p_data->>'restrictions',''),COALESCE((p_data->>'published')::boolean,false))
      ON CONFLICT(depot_id) DO UPDATE SET ports=EXCLUDED.ports,address=EXCLUDED.address,opening_hours=EXCLUDED.opening_hours,emails=EXCLUDED.emails,phones=EXCLUDED.phones,scheduling_url=EXCLUDED.scheduling_url,instructions=EXCLUDED.instructions,restrictions=EXCLUDED.restrictions,published=EXCLUDED.published,updated_at=now();
    WHEN 'agent' THEN
      v_id:=COALESCE(NULLIF(p_data->>'id','')::uuid,gen_random_uuid()); v_key:=v_id::text;
      SELECT to_jsonb(a) INTO v_before FROM public.port_agents a WHERE id=v_id;
      INSERT INTO public.port_agents(id,name,ports,emails,active) VALUES(v_id,btrim(p_data->>'name'),v_ports,v_emails,COALESCE((p_data->>'active')::boolean,true))
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,ports=EXCLUDED.ports,emails=EXCLUDED.emails,active=EXCLUDED.active;
    WHEN 'contact' THEN
      v_key:=p_data->>'key';
      IF v_key NOT IN ('importacao','exportacao','containers','geral') THEN RAISE EXCEPTION 'Assunto de atendimento inválido.' USING ERRCODE='22023'; END IF;
      SELECT to_jsonb(c) INTO v_before FROM public.portal_information_contacts c WHERE key=v_key;
      INSERT INTO public.portal_information_contacts(key,title,description,emails,phones,whatsapp,address,active)
      VALUES(v_key,p_data->>'title',COALESCE(p_data->>'description',''),v_emails,v_phones,NULLIF(btrim(p_data->>'whatsapp'),''),COALESCE(p_data->>'address',''),COALESCE((p_data->>'active')::boolean,true))
      ON CONFLICT(key) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,emails=EXCLUDED.emails,phones=EXCLUDED.phones,whatsapp=EXCLUDED.whatsapp,address=EXCLUDED.address,active=EXCLUDED.active;
    WHEN 'carrier' THEN
      v_key:=p_data->>'carrier_id';
      SELECT to_jsonb(c) INTO v_before FROM public.carrier_portal_information c WHERE carrier_id=v_key::bigint;
      INSERT INTO public.carrier_portal_information(carrier_id,tracking_url) VALUES(v_key::bigint,NULLIF(btrim(p_data->>'tracking_url'),''))
      ON CONFLICT(carrier_id) DO UPDATE SET tracking_url=EXCLUDED.tracking_url;
    WHEN 'notes' THEN
      v_key:='1';
      SELECT to_jsonb(s) INTO v_before FROM public.portal_information_settings s WHERE id=1;
      INSERT INTO public.portal_information_settings(id,demurrage_notes) VALUES(1,COALESCE(p_data->>'demurrage_notes','')) ON CONFLICT(id) DO UPDATE SET demurrage_notes=EXCLUDED.demurrage_notes;
    ELSE RAISE EXCEPTION 'Tipo de informação inválido.' USING ERRCODE='22023';
  END CASE;
  INSERT INTO public.audit_logs(entity_type,entity_id,field_name,old_value,new_value,changed_by,justification)
  VALUES('portal_information_'||p_kind,v_key,'information',v_before::text,p_data::text,auth.uid(),'Atualização das informações do Portal no Vela');
END $function$;
