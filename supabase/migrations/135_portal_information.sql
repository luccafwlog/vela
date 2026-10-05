-- Central de Informações: Vela é a fonte oficial do Portal.
-- Novos complementos não alteram depots.port_id nem tabelas de faturamento.
-- Reversão operacional: despublicar informações e retirar indicações pela RPC.
-- Não há alteração de snapshots ou dados financeiros existentes.

CREATE TABLE public.depot_portal_information (
  depot_id uuid PRIMARY KEY REFERENCES public.depots(id) ON DELETE CASCADE,
  ports text[] NOT NULL DEFAULT '{}',
  address text NOT NULL DEFAULT '', opening_hours text NOT NULL DEFAULT '',
  emails text[] NOT NULL DEFAULT '{}', phones text[] NOT NULL DEFAULT '{}',
  scheduling_url text, instructions text NOT NULL DEFAULT '',
  restrictions text NOT NULL DEFAULT '', published boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT depot_portal_schedule_url CHECK (scheduling_url IS NULL OR scheduling_url ~* '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$'),
  CONSTRAINT depot_published_port CHECK (NOT published OR cardinality(ports) > 0)
);
CREATE TABLE public.port_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (btrim(name) <> ''),
  ports text[] NOT NULL CHECK (cardinality(ports) > 0), emails text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.portal_information_contacts (
  key text PRIMARY KEY, title text NOT NULL, description text NOT NULL DEFAULT '',
  emails text[] NOT NULL DEFAULT '{}', phones text[] NOT NULL DEFAULT '{}',
  whatsapp text, address text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true,
  CONSTRAINT portal_whatsapp_url CHECK (whatsapp IS NULL OR whatsapp ~* '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$')
);
CREATE TABLE public.carrier_portal_information (
  carrier_id bigint PRIMARY KEY REFERENCES public.carriers(id) ON DELETE CASCADE,
  tracking_url text,
  CONSTRAINT carrier_tracking_url CHECK (tracking_url IS NULL OR tracking_url ~* '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$')
);
CREATE TABLE public.portal_information_settings (
  id integer PRIMARY KEY CHECK (id = 1), demurrage_notes text NOT NULL DEFAULT ''
);
CREATE TABLE public.container_return_instructions (
  container_id bigint PRIMARY KEY REFERENCES public.bl_containers(id) ON DELETE CASCADE,
  depot_ids uuid[] NOT NULL CHECK (cardinality(depot_ids) > 0),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid NOT NULL REFERENCES auth.users(id)
);

ALTER TABLE public.depot_portal_information ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.port_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_information_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_portal_information ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_information_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.container_return_instructions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['depot_portal_information','port_agents','portal_information_contacts','carrier_portal_information','portal_information_settings','container_return_instructions'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY internal_information_read ON public.%I FOR SELECT TO authenticated USING (public.is_active_read_user())', t);
  END LOOP;
END $$;

CREATE FUNCTION public._portal_information_core(p_internal boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $$
SELECT jsonb_build_object(
  'depots', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', d.id, 'code', d.code, 'name', COALESCE(d.name,d.code), 'active', d.active,
    'ports', COALESCE(i.ports,'{}'::text[]), 'address', COALESCE(i.address,''),
    'opening_hours', COALESCE(i.opening_hours,''), 'emails', COALESCE(i.emails,'{}'::text[]),
    'phones', COALESCE(i.phones,'{}'::text[]), 'scheduling_url', i.scheduling_url,
    'instructions', COALESCE(i.instructions,''), 'restrictions', COALESCE(i.restrictions,''),
    'published', COALESCE(i.published,false), 'updated_at', i.updated_at
  ) ORDER BY d.code) FROM public.depots d LEFT JOIN public.depot_portal_information i ON i.depot_id=d.id
    WHERE d.tipo='depot' AND (p_internal OR (d.active AND i.published))), '[]'::jsonb),
  'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'ports',a.ports,'emails',a.emails,'active',a.active) ORDER BY a.name)
    FROM public.port_agents a WHERE p_internal OR a.active), '[]'::jsonb),
  'contacts', COALESCE((SELECT jsonb_agg(jsonb_build_object('key',c.key,'title',c.title,'description',c.description,'emails',c.emails,'phones',c.phones,'whatsapp',c.whatsapp,'address',c.address,'active',c.active) ORDER BY c.key)
    FROM public.portal_information_contacts c WHERE p_internal OR c.active), '[]'::jsonb),
  'carriers', COALESCE((SELECT jsonb_agg(jsonb_build_object('carrier_id',c.id,'name',c.name,'tracking_url',i.tracking_url) ORDER BY c.name)
    FROM public.carriers c LEFT JOIN public.carrier_portal_information i ON i.carrier_id=c.id WHERE p_internal OR i.tracking_url IS NOT NULL), '[]'::jsonb),
  'local_tables', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'pod',public.normalize_port_code(t.pod),'cargo_mode',t.cargo_mode,'valid_from',t.valid_from,'valid_to',t.valid_to,
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'currency',COALESCE(i.currency,'BRL'),'unit_value_brl',i.unit_value_brl,'unit_value_usd',i.unit_value_usd,
       'application_basis',i.application_basis,'cargo_profile',i.cargo_profile,'manual_only',i.manual_only,'applies_to_soc',i.applies_to_soc) ORDER BY i.sort_order,i.id)
      FROM public.charge_table_items i WHERE i.charge_table_id=t.id AND i.active), '[]'::jsonb)) ORDER BY t.pod,t.cargo_mode)
    FROM public.charge_tables t WHERE t.active AND t.id=public.resolve_local_charge_table_id(t.cargo_mode,t.pod)), '[]'::jsonb),
  'demurrage_rates', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'container_type',r.container_type,'free_days',r.free_days,'p1_day_from',r.p1_day_from,'p1_day_to',r.p1_day_to,
    'p1_usd',r.p1_usd,'p2_day_from',r.p2_day_from,'p2_usd',r.p2_usd,'valid_from',r.valid_from,'valid_to',r.valid_to) ORDER BY r.container_type)
    FROM (SELECT DISTINCT ON (upper(btrim(container_type))) * FROM public.demurrage_rates
      WHERE active AND valid_from<=CURRENT_DATE AND (valid_to IS NULL OR valid_to>=CURRENT_DATE)
      ORDER BY upper(btrim(container_type)),valid_from DESC,id DESC) r), '[]'::jsonb),
  'demurrage_notes', COALESCE((SELECT demurrage_notes FROM public.portal_information_settings WHERE id=1),''),
  'ports', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',p.code,'name',p.name) ORDER BY p.name) FROM (
    SELECT DISTINCT ON (code) code,name FROM (
      SELECT public.normalize_port_code(locode) code,COALESCE(name,locode) name,0 priority FROM public.ports WHERE locode LIKE 'BR%'
      UNION ALL SELECT unnest(ports),unnest(ports),1 FROM public.depot_portal_information
      UNION ALL SELECT unnest(ports),unnest(ports),1 FROM public.port_agents
    ) x WHERE code IS NOT NULL ORDER BY code,priority
  ) p), '[]'::jsonb)
);
$$;

CREATE FUNCTION public.portal_get_information() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $$
BEGIN
  PERFORM public.current_portal_customer_id();
  RETURN public._portal_information_core(false);
END $$;
CREATE FUNCTION public.portal_inspect_get_information(p_customer_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $$
BEGIN
  PERFORM public._portal_inspect_guard(p_customer_id);
  RETURN public._portal_information_core(false);
END $$;
CREATE FUNCTION public.internal_get_portal_information() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $$
BEGIN
  IF NOT public.is_active_read_user() THEN RAISE EXCEPTION 'Sem permissão para consultar informações.' USING ERRCODE='42501'; END IF;
  RETURN public._portal_information_core(true);
END $$;

CREATE FUNCTION public.internal_save_portal_information(p_kind text,p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE v_ports text[]; v_emails text[]; v_phones text[]; v_id uuid; v_before jsonb; v_key text;
BEGIN
  IF NOT public.is_active_read_user() OR public._portal_actor_role() NOT IN ('administrativo','equipamentos')
    OR (p_kind<>'depot' AND public._portal_actor_role()<>'administrativo') THEN
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
END $$;

CREATE FUNCTION public._container_return_guidance_core(p_container_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE c record; v_instruction record; v_depots jsonb; v_status text; v_catalog jsonb;
BEGIN
  SELECT bc.id,bc.container_number,bc.return_date,bc.ownership,bc.bl_id,b.pod,b.voyage_id INTO c
    FROM public.bl_containers bc JOIN public.bls b ON b.id=bc.bl_id WHERE bc.id=p_container_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Container não disponível para consulta.' USING ERRCODE='42501'; END IF;
  SELECT i.* INTO v_instruction FROM public.container_return_instructions i
    JOIN public.bl_containers linked ON linked.id=i.container_id JOIN public.bls b ON b.id=linked.bl_id
    WHERE linked.id=p_container_id OR (c.voyage_id IS NOT NULL AND b.voyage_id=c.voyage_id AND linked.container_number=c.container_number)
    ORDER BY (linked.id=p_container_id) DESC,i.updated_at DESC LIMIT 1;
  v_status:=CASE WHEN upper(COALESCE(c.ownership,''))='SOC' THEN 'soc' WHEN v_instruction.container_id IS NOT NULL THEN 'specific' ELSE 'general' END;
  v_catalog:=public._portal_information_core(false);
  SELECT COALESCE(jsonb_agg(d ORDER BY d->>'code'),'[]'::jsonb) INTO v_depots
    FROM jsonb_array_elements(v_catalog->'depots') d
    WHERE v_status<>'soc' AND (d->'ports') ? public.normalize_port_code(c.pod)
      AND (v_status='general' OR (d->>'id')::uuid=ANY(v_instruction.depot_ids));
  IF v_status='specific' AND jsonb_array_length(v_depots)=0 THEN v_status:='unavailable'; END IF;
  RETURN jsonb_build_object('container_id',c.id,'container_number',c.container_number,'bl_id',c.bl_id,'pod',public.normalize_port_code(c.pod),'return_date',c.return_date,'status',v_status,'depots',v_depots,'updated_at',v_instruction.updated_at);
END $$;
CREATE FUNCTION public.portal_get_return_guidance(p_container_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE v_customer bigint:=public.current_portal_customer_id();
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.bl_containers c JOIN public.bls b ON b.id=c.bl_id WHERE c.id=p_container_id AND b.customer_id=v_customer AND public.bl_has_portal_release(b.id)) THEN
    RAISE EXCEPTION 'Container não disponível para consulta.' USING ERRCODE='42501';
  END IF;
  RETURN public._container_return_guidance_core(p_container_id);
END $$;
CREATE FUNCTION public.portal_inspect_get_return_guidance(p_customer_id bigint,p_container_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE v_customer bigint:=public._portal_inspect_guard(p_customer_id);
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.bl_containers c JOIN public.bls b ON b.id=c.bl_id WHERE c.id=p_container_id AND b.customer_id=v_customer AND public.bl_has_portal_release(b.id)) THEN
    RAISE EXCEPTION 'Container não disponível para consulta.' USING ERRCODE='42501';
  END IF;
  RETURN public._container_return_guidance_core(p_container_id);
END $$;
CREATE FUNCTION public.internal_get_return_guidance(p_container_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $$
BEGIN
  IF NOT public.is_active_read_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE='42501'; END IF;
  RETURN public._container_return_guidance_core(p_container_id) || jsonb_build_object('reason',COALESCE((SELECT reason FROM public.container_return_instructions WHERE container_id=p_container_id),''));
END $$;
CREATE FUNCTION public.set_container_return_instruction(p_container_id bigint,p_depot_ids uuid[],p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE c record; v_ids uuid[]; v_target record; v_before jsonb;
BEGIN
  IF NOT public.is_active_read_user() OR public._portal_actor_role() NOT IN ('administrativo','equipamentos') THEN RAISE EXCEPTION 'Sem permissão para indicar devolução.' USING ERRCODE='42501'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Informe a justificativa da alteração.' USING ERRCODE='22023'; END IF;
  SELECT bc.id,bc.container_number,bc.ownership,bc.bl_id,b.pod,b.voyage_id INTO c FROM public.bl_containers bc JOIN public.bls b ON b.id=bc.bl_id WHERE bc.id=p_container_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Container inexistente.' USING ERRCODE='22023'; END IF;
  -- Uma unidade física compartilhada entre BLs da mesma viagem tem uma orientação.
  PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(c.voyage_id::text,c.bl_id)||':'||c.container_number,0));
  SELECT COALESCE(array_agg(DISTINCT id),'{}'::uuid[]) INTO v_ids FROM unnest(COALESCE(p_depot_ids,'{}'::uuid[])) id;
  IF cardinality(v_ids)>0 AND upper(COALESCE(c.ownership,''))='SOC' THEN RAISE EXCEPTION 'Container SOC não exige devolução.' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_ids) AS selected(depot_id) LEFT JOIN public.depots d ON d.id=selected.depot_id LEFT JOIN public.depot_portal_information i ON i.depot_id=d.id
    WHERE d.id IS NULL OR NOT d.active OR d.tipo<>'depot' OR NOT COALESCE(i.published,false) OR NOT public.normalize_port_code(c.pod)=ANY(i.ports)) THEN
    RAISE EXCEPTION 'Selecione depots ativos e publicados no porto de destino.' USING ERRCODE='22023';
  END IF;
  FOR v_target IN SELECT bc.id FROM public.bl_containers bc JOIN public.bls b ON b.id=bc.bl_id
    WHERE bc.id=c.id OR (c.voyage_id IS NOT NULL AND b.voyage_id=c.voyage_id AND bc.container_number=c.container_number)
    ORDER BY bc.id FOR UPDATE OF bc LOOP
    SELECT to_jsonb(i) INTO v_before FROM public.container_return_instructions i WHERE container_id=v_target.id;
    IF cardinality(v_ids)=0 THEN
      DELETE FROM public.container_return_instructions WHERE container_id=v_target.id;
    ELSE
      INSERT INTO public.container_return_instructions(container_id,depot_ids,reason,updated_by) VALUES(v_target.id,v_ids,btrim(p_reason),auth.uid())
      ON CONFLICT(container_id) DO UPDATE SET depot_ids=EXCLUDED.depot_ids,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=now();
    END IF;
    INSERT INTO public.audit_logs(entity_type,entity_id,field_name,old_value,new_value,changed_by,justification)
    VALUES('container_return_instruction',v_target.id::text,'depot_ids',v_before::text,to_jsonb(v_ids)::text,auth.uid(),btrim(p_reason));
  END LOOP;
END $$;

DO $$
DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['_portal_information_core(boolean)','_container_return_guidance_core(bigint)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||signature||' FROM PUBLIC, anon, authenticated';
  END LOOP;
  FOREACH signature IN ARRAY ARRAY['portal_get_information()','portal_inspect_get_information(bigint)','internal_get_portal_information()',
    'internal_save_portal_information(text,jsonb)','portal_get_return_guidance(bigint)','portal_inspect_get_return_guidance(bigint,bigint)',
    'internal_get_return_guidance(bigint)','set_container_return_instruction(bigint,uuid[],text)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||signature||' FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||signature||' TO authenticated';
  END LOOP;
END $$;

-- Cadastro inicial das páginas FWLOG, consultadas em 03/10/2026. Não há planilha.
-- Reusar o depot existente pelo código/nome; criar somente o local ausente.
DO $$
DECLARE source record; v_id uuid;
BEGIN
  FOR source IN SELECT * FROM (VALUES
    ('CAP','CAPIXABA TERMINAIS','BRVIX','Av. Francisco de Assis Silva, S/N – Vale Encantado – Vila Velha/ES.','07h às 10h30 e 13h às 18h',ARRAY['gate@capixabaterminais.com.br','operacional@capixabaterminais.com.br'],ARRAY['+55 27 99954-5584','+55 27 99946-3651'],NULL::text,'Encaminhe e-mail ao depot com um dia de antecedência e aguarde confirmação.','Recebe flat rack conforme orientação da FWLOG.'),
    ('TCVV','TCVV – TERMINAL DE CONTAINER DE VILA VELHA','BRVIX','Av. Francisco de Assis Silva, 950 – Vale Encantado – Vila Velha/ES.','07h às 10h30 e 13h às 16h30',ARRAY['giselle@tcvv.com.br','maristelaboghi@tcvv.com.br','thalita@tcvv.com.br','thais@tcvv.com.br','amadaly@tcvv.com.br'],ARRAY['+55 27 3349-3008'],NULL::text,'Encaminhe e-mail ao depot com um dia de antecedência e aguarde confirmação.','Não recebe flat rack. Agende esse equipamento junto à Capixaba Terminais.'),
    ('ZIRAN','ZIRAN LOG','BRSSA','Rua Ruth Fernandes, 50 – Valéria – BA, 413005-010','Segunda a sexta: 07h30 às 16h30; domingo: fechado','{}'::text[],ARRAY['(071) 9666-0584'],'http://ziransalvador.com.br/arearestritayu','Cliente ou transportadora deve acessar o portal do depot com usuário e senha.',''),
    ('JEW','J&W','BRSSA','Av. Elmo Serejo de Farias – Núcleo Hab. Rubens Costa Cia I, Simões Filho – BA, 43700-000','','{}'::text[],ARRAY['Lourival: (71) 99726-7246','Wander: (71) 99733-2236','Elton: (71) 98216-0030'],'http://websag.jewsolucoesintegradas.com.br/','Cliente ou transportadora deve acessar o portal do depot com usuário e senha.',''),
    ('PONTUAL','PONTUAL SIMÕES FILHO','BRSSA','Via Urbana, 1.338 – Cia Sul – CEP 43.700-000 – Simões Filho/BA. Antiga USIMA, vizinho à XEROX.','Segunda a sexta: 08h às 16h45; sábado: 08h às 11h30; domingo: fechado','{}'::text[],ARRAY['(071) 3594-5733'],'http://websag.depotpontual.com.br/','Cliente ou transportadora deve acessar o portal do depot com usuário e senha.',''),
    ('WINDROSE','Windrose Logística – Terminal Norte','BRSUA','Estrada TDR Norte, 7481 – Distrito Industrial de Suape','Segunda a sexta: 08h às 22h; sábado: 08h às 12h','{}'::text[],ARRAY['81 3561-2476','81 99198-5683 (Elisangela)'],NULL::text,'Não é necessário agendamento. Apresente o Fólio da Tecon Suape ou do terminal responsável pela liberação, com o número do container.','')
  ) AS s(code,name,port,address,hours,emails,phones,url,instructions,restrictions) LOOP
    SELECT id INTO v_id FROM public.depots WHERE tipo='depot' AND (upper(code)=source.code OR upper(name)=upper(source.name)) ORDER BY (upper(code)=source.code) DESC LIMIT 1;
    IF v_id IS NULL THEN
      INSERT INTO public.depots(code,name,tipo) VALUES(source.code,source.name,'depot') RETURNING id INTO v_id;
    END IF;
    INSERT INTO public.depot_portal_information(depot_id,ports,address,opening_hours,emails,phones,scheduling_url,instructions,restrictions,published)
    VALUES(v_id,ARRAY[source.port],source.address,source.hours,source.emails,source.phones,source.url,source.instructions,source.restrictions,true)
    ON CONFLICT(depot_id) DO NOTHING;
  END LOOP;
END $$;
INSERT INTO public.port_agents(name,ports,emails) VALUES
 ('FWLOG',ARRAY['BRVIX','BRSSA','BRSUA'],ARRAY['importacao@fwlog.com.br','exportacao@fwlog.com.br','eqp@fwlog.com.br','fwlog@fwlog.com.br']),
 ('UNIMAR',ARRAY['BRSSZ','BRITJ','BRPNG'],ARRAY['imp.ssz@unishipping.com.br','central.docimpo@unishipping.com.br']),
 ('ISS',ARRAY['BRIGI','BRRIO'],ARRAY['issbrazil.documentation@iss-shipping.com','ecsa.roc@iss-shipping.com']),
 ('WILSON SONS',ARRAY['BRMAO'],ARRAY['operation.manaus@wilsonsons.com.br','documentation.liner@wilsonsons.com.br','renata.teglas@wilsonsons.com.br']);
INSERT INTO public.portal_information_contacts(key,title,description,emails,phones,whatsapp,address) VALUES
 ('importacao','Importação','Posição de navios, BLs, CE Mercante, documentação, fretes e taxas locais, impressão e liberação de BLs e desbloqueio de CEs.',ARRAY['importacao@fwlog.com.br'],'{}',NULL,''),
 ('exportacao','Exportação','Cotações de frete, solicitações de booking, posição de navios, documentação e liberação de BLs.',ARRAY['exportacao@fwlog.com.br'],'{}',NULL,''),
 ('containers','Containers','Depots, devolução de containers vazios, Demurrage e avarias.',ARRAY['eqp@fwlog.com.br'],'{}',NULL,''),
 ('geral','Assuntos Gerais','Assuntos institucionais, primeiro contato, cotações de frete e reclamações.',ARRAY['fwlog@fwlog.com.br'],ARRAY['+55 (27) 99690-7107 (apenas WhatsApp)'],'https://wa.me/5527996907107','Rua Desembargador Ferreira Coelho, nº 330, salas 813/814, Ed. Eldorado Center, CEP 29052-901, Vitória/ES');
INSERT INTO public.carrier_portal_information(carrier_id,tracking_url)
 SELECT id,'https://spe.coscoshipping.com/main/newcargotracking?label=T&value=' FROM public.carriers WHERE name ~* 'cosco|cssc' OR scac='COSU'
 ON CONFLICT(carrier_id) DO NOTHING;
INSERT INTO public.portal_information_settings(id,demurrage_notes) VALUES(1,
 'A contagem do free time começa no dia seguinte à descarga e se encerra na data de devolução da unidade vazia ao depot indicado pelo armador. A contagem usa dias corridos, incluindo sábados, domingos e feriados. Encargos de armazenamento e transporte de carga refrigerada não estão incluídos na tarifa. Registre evidências de qualquer impedimento de devolução e entre em contato com a equipe de Containers.');

-- Mesma precedência do cálculo oficial: BL, acordo vigente na descarga, tabela.
CREATE OR REPLACE FUNCTION public._portal_list_operation_bls_without_transshipment_core(p_customer_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN (
    WITH active_rates AS (
      SELECT DISTINCT ON (upper(trim(container_type)))
        upper(trim(container_type)) AS container_type,
        free_days
      FROM public.demurrage_rates
      WHERE active = true
        AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
        AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
      ORDER BY upper(trim(container_type)), valid_from DESC NULLS LAST, id DESC
    ),
    bl_rows AS (
      SELECT
        b.id AS bl_id,
        b.customer_id,
        vs.carrier_id,
        carrier.name AS carrier_name,
        tracking.tracking_url,
        b.ce_mercante,
        b.pol,
        b.pod,
        b.voyage_id,
        v.voyage_number,
        vs.name AS vessel_name,
        b.free_time_override,
        b.cargo_mode,
        b.bb_weight_ton,
        b.bb_packages_qty
      FROM public.bls AS b
      LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
      LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
      LEFT JOIN public.carriers carrier ON carrier.id=vs.carrier_id
      LEFT JOIN public.carrier_portal_information tracking ON tracking.carrier_id=carrier.id
      WHERE b.customer_id = p_customer_id AND public.bl_has_portal_release(b.id)
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'bl_id', bl.bl_id,
          'ce_mercante', bl.ce_mercante,
          'pol', bl.pol,
          'pod', bl.pod,
          'voyage_id', bl.voyage_id,
          'voyage_number', bl.voyage_number,
          'vessel_name', bl.vessel_name,
          'carrier_id',bl.carrier_id,'carrier_name',bl.carrier_name,'tracking_url',bl.tracking_url,
          'container_count', container_summary.container_count,
          'containers_in_demurrage', container_summary.containers_in_demurrage,
          'containers_returned', container_summary.containers_returned,
          'containers', container_summary.containers,
          'cargo_mode', bl.cargo_mode,
          'bb_weight_ton', bl.bb_weight_ton,
          'bb_packages_qty', bl.bb_packages_qty
        )
        ORDER BY bl.voyage_id DESC NULLS LAST, bl.bl_id
      ),
      '[]'::jsonb
    )
    FROM bl_rows AS bl
    LEFT JOIN LATERAL (
      WITH calculated AS (
        SELECT
          c.id,
          c.container_number,
          c.type,
          c.ownership,
          c.discharge_date,
          c.return_date,
          CASE
            WHEN c.discharge_date IS NULL OR upper(COALESCE(c.ownership,''))='SOC' THEN NULL
            ELSE GREATEST(COALESCE(c.return_date, CURRENT_DATE) - c.discharge_date, 0)
          END AS usage_days,
          CASE
            WHEN c.discharge_date IS NULL OR upper(COALESCE(c.ownership,''))='SOC' THEN NULL
            ELSE COALESCE(bl.free_time_override,agreement.free_days,ar.free_days)
          END AS free_time_days
        FROM public.bl_containers AS c
        LEFT JOIN active_rates AS ar
          ON ar.container_type = CASE upper(trim(COALESCE(c.type, '')))
        WHEN '20GP' THEN '20GP'
        WHEN '20G0' THEN '20GP'
        WHEN '20HC' THEN '20GP'
        WHEN '20HQ' THEN '20GP'
        WHEN '22G1' THEN '20GP'
        WHEN '20G1' THEN '20GP'
        WHEN '40GP' THEN '40GP'
        WHEN '40G0' THEN '40GP'
        WHEN '40HC' THEN '40GP'
        WHEN '40HQ' THEN '40GP'
        WHEN '40G1' THEN '40GP'
        WHEN '42G1' THEN '40GP'
        WHEN '45G1' THEN '40GP'
        WHEN '20FR' THEN '20FR'
        WHEN '20OT' THEN '20FR'
        WHEN '20FT' THEN '20FR'
        WHEN '40FR' THEN '40FR'
        WHEN '40OT' THEN '40FR'
        WHEN '40FT' THEN '40FR'
        WHEN '20RF' THEN '20RF'
        WHEN '20RQ' THEN '20RF'
        WHEN '20R1' THEN '20RF'
        WHEN '40RF' THEN '40RF'
        WHEN '40RQ' THEN '40RF'
        WHEN '40R1' THEN '40RF'
        WHEN '45R1' THEN '40RF'
        ELSE upper(trim(COALESCE(c.type, '')))
      END
        LEFT JOIN LATERAL (
          SELECT a.free_days FROM public.customer_demurrage_agreements a
          WHERE a.customer_id=bl.customer_id AND a.active AND c.discharge_date>=a.valid_from
            AND (a.valid_to IS NULL OR c.discharge_date<=a.valid_to)
          ORDER BY a.valid_from DESC,a.id DESC LIMIT 1
        ) agreement ON true
        WHERE c.bl_id = bl.bl_id
      ),
      with_demurrage AS (
        SELECT
          calculated.*,
          CASE
            WHEN usage_days IS NULL OR free_time_days IS NULL THEN NULL
            ELSE GREATEST(usage_days - free_time_days, 0)
          END AS demurrage_days
        FROM calculated
      ),
      with_status AS (
        SELECT
          with_demurrage.*,
          CASE
            WHEN upper(COALESCE(ownership,''))='SOC' THEN 'soc'
            WHEN discharge_date IS NULL THEN 'sem_descarga'
            WHEN return_date IS NOT NULL THEN 'devolvido'
            WHEN free_time_days IS NULL THEN 'tarifa_indisponivel'
            WHEN COALESCE(demurrage_days, 0) > 0 THEN 'em_demurrage'
            ELSE 'dentro_free_time'
          END AS status
        FROM with_demurrage
      )
      SELECT
        COUNT(*)::int AS container_count,
        COUNT(*) FILTER (WHERE status = 'em_demurrage')::int AS containers_in_demurrage,
        COUNT(*) FILTER (WHERE status = 'devolvido')::int AS containers_returned,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', id,
              'container_number', container_number,
              'type', type,
              'discharge_date', discharge_date,
              'return_date', return_date,
              'usage_days', usage_days,
              'free_time_days', free_time_days,
              'demurrage_days', demurrage_days,
              'status', status
            )
            ORDER BY container_number
          ),
          '[]'::jsonb
        ) AS containers
      FROM with_status
    ) AS container_summary ON true
  );
END;
$$;

REVOKE ALL ON FUNCTION public._portal_list_operation_bls_without_transshipment_core(bigint) FROM PUBLIC, anon, authenticated;
