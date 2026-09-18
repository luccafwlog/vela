-- Prova comportamental da migration 045 (roteamento por Caixa de Comunicacao e
-- NOB automatico por Frente de Operacao) contra um Postgres real e descartavel.
-- Roda no CI apos o replay das migrations; nao e teste de regex.
-- Todo o cenario vive numa transacao que termina em ROLLBACK.
\set ON_ERROR_STOP on
SET search_path TO public;
SET ROLE postgres;

BEGIN;

-- Cenário: navio no porto BRSSZ, dois terminais atracados.
--   ACME      -> cargo_mode 'container'    (frente carga_cheia  -> TERM-A)
--   BETA      -> cargo_mode 'carga_solta'  (frente carga_solta  -> TERM-B)
-- Contatos:
--   acme-doc@  -> caixa documentacao_operacao   (deve receber)
--   acme-fin@  -> caixa financeiro APENAS       (NÃO deve receber aviso operacional)
--   beta-doc@  -> caixa documentacao_operacao   (deve receber)

INSERT INTO carriers (id, name) VALUES (9901, 'CARRIER PROVA');
INSERT INTO vessels (id, name, carrier_id) VALUES (9901, 'MSC PROVA', 9901);
INSERT INTO ports (id, name, locode) VALUES (9901, 'SANTOS', 'BRSSZ');
INSERT INTO voyages (id, vessel_id, voyage_number, eta)
  VALUES (9901, 9901, '2401E', now() + interval '2 days');

INSERT INTO depots (id, code, name, active, tipo, port_id) VALUES
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'TERM-A', 'Terminal A', true, 'terminal_portuario', 9901),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'TERM-B', 'Terminal B', true, 'terminal_portuario', 9901);

INSERT INTO customers (id, cnpj_cpf, name) VALUES
  (9901, '11222333000181', 'ACME'),
  (9902, '11444777000161', 'BETA');

INSERT INTO customer_contacts (id, customer_id, name, email) VALUES
  (9901, 9901, 'ACME Doc', 'acme-doc@ex.com'),
  (9902, 9901, 'ACME Fin', 'acme-fin@ex.com'),
  (9903, 9902, 'BETA Doc', 'beta-doc@ex.com');

DELETE FROM customer_contact_box_links WHERE contact_id IN (9901, 9902, 9903);
INSERT INTO customer_contact_box_links (contact_id, box_code) VALUES
  (9901, 'documentacao_operacao'),
  (9902, 'financeiro'),
  (9903, 'documentacao_operacao');

INSERT INTO bls (id, voyage_id, customer_id, pod, cargo_mode, bb_weight_ton) VALUES
  ('BL-ACME-1', 9901, 9901, 'BRSSZ', 'container', NULL),
  ('BL-BETA-1', 9901, 9902, 'BRSSZ', 'carga_solta', 1);

-- Escala com ETA dentro da janela D-5 (fonte real: audit_logs).
INSERT INTO audit_logs (entity_type, entity_id, field_name, new_value, changed_at) VALUES
  ('voyage_pod_schedule', '9901::BRSSZ', 'eta', to_char(now() + interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SSOF'), now());

-- Segunda escala, com ATA de 5 dias atras: prova o NOR na janela de 30 dias.
INSERT INTO ports (id, name, locode) VALUES (9902, 'VITORIA', 'BRVIX');
INSERT INTO bls (id, voyage_id, customer_id, pod, cargo_mode) VALUES
  ('BL-ACME-2', 9901, 9901, 'BRVIX', 'container');
INSERT INTO audit_logs (entity_type, entity_id, field_name, new_value, changed_at) VALUES
  ('voyage_pod_schedule', '9901::BRVIX', 'eta', to_char(now() - interval '6 days', 'YYYY-MM-DD"T"HH24:MI:SSOF'), now()),
  ('voyage_pod_schedule', '9901::BRVIX', 'ata', to_char(now() - interval '5 days', 'YYYY-MM-DD"T"HH24:MI:SSOF'), now());

-- Terceira escala com ATA antigo (45 dias): prova que o NOR nao dispara fora da janela de 30 dias.
INSERT INTO ports (id, name, locode) VALUES (9903, 'RIO DE JANEIRO', 'BRRIO');
INSERT INTO bls (id, voyage_id, customer_id, pod, cargo_mode) VALUES
  ('BL-ACME-3', 9901, 9901, 'BRRIO', 'container');
INSERT INTO audit_logs (entity_type, entity_id, field_name, new_value, changed_at) VALUES
  ('voyage_pod_schedule', '9901::BRRIO', 'ata', to_char(now() - interval '45 days', 'YYYY-MM-DD"T"HH24:MI:SSOF'), now());

-- Duas Atracações em Santos, ambas com ATB dentro dos 30 dias.
INSERT INTO voyage_escala_terminal_state (id, voyage_id, port, port_id, terminal_id, terminal_atb) VALUES
  ('cccccccc-0000-4000-8000-00000000000c', 9901, 'BRSSZ', 9901, 'aaaaaaaa-0000-4000-8000-00000000000a', now() - interval '1 day'),
  ('dddddddd-0000-4000-8000-00000000000d', 9901, 'BRSSZ', 9901, 'bbbbbbbb-0000-4000-8000-00000000000b', now() - interval '5 days');

-- Atracação antiga (45 dias): prova que o NOB nao dispara fora da janela de 30 dias.
-- Ancorada na escala BRRIO (BL-ACME-3 / container -> carga_cheia), para garantir que teria
-- produzido comunicado caso a guarda de 30 dias nao existisse.
INSERT INTO depots (id, code, name, active, tipo, port_id) VALUES
  ('eeeeeeee-0000-4000-8000-00000000000e', 'TERM-OLD', 'Terminal Antigo', true, 'terminal_portuario', 9903);
INSERT INTO voyage_escala_terminal_state (id, voyage_id, port, port_id, terminal_id, terminal_atb) VALUES
  ('ffffffff-0000-4000-8000-00000000000f', 9901, 'BRRIO', 9903, 'eeeeeeee-0000-4000-8000-00000000000e', now() - interval '45 days');

-- Atribuição das Frentes de Operação:
--   BRSSZ: carga_cheia -> TERM-A, carga_solta -> TERM-B.
--   BRRIO: carga_cheia -> TERM-OLD (cobre BL-ACME-3).
INSERT INTO voyage_escala_operation_fronts (voyage_id, port, port_id, sentido, modalidade, terminal_id, source) VALUES
  (9901, 'BRSSZ', 9901, 'importacao', 'carga_cheia', 'aaaaaaaa-0000-4000-8000-00000000000a', 'operational_data'),
  (9901, 'BRSSZ', 9901, 'importacao', 'carga_solta', 'bbbbbbbb-0000-4000-8000-00000000000b', 'operational_data'),
  (9901, 'BRRIO', 9903, 'importacao', 'carga_cheia', 'eeeeeeee-0000-4000-8000-00000000000e', 'operational_data');

-- ===========================================================================
SET LOCAL request.jwt.claim.role = 'service_role';
CREATE TEMP TABLE resultado AS
SELECT * FROM jsonb_array_elements(public.evaluate_and_dispatch_automatic_communications(now())) AS c(item);
SET LOCAL request.jwt.claim.role = 'authenticated';

\echo ''
\echo '=== CANDIDATOS PRODUZIDOS ==='
SELECT item->>'kind' AS kind,
       item->>'customer_name' AS cliente,
       item->>'terminal_name' AS terminal,
       item->>'emails' AS emails
FROM resultado ORDER BY 1, 2, 3;

\echo ''
\echo '=== ASSERÇÕES ==='
DO $$
DECLARE v_emails TEXT; v_n INT;
BEGIN
  -- 1. NOA da ACME sai apenas para o contato da caixa Documentação e Operação.
  SELECT item->>'emails' INTO v_emails FROM resultado
   WHERE item->>'kind' = 'aviso_chegada_noa' AND item->>'customer_name' = 'ACME';
  IF v_emails IS NULL THEN RAISE EXCEPTION 'FALHOU: ACME nao recebeu NOA'; END IF;
  IF v_emails LIKE '%acme-fin@%' THEN
    RAISE EXCEPTION 'FALHOU: contato da caixa Financeiro recebeu aviso operacional (%)', v_emails;
  END IF;
  IF v_emails NOT LIKE '%acme-doc@%' THEN
    RAISE EXCEPTION 'FALHOU: contato da caixa Doc&Op nao recebeu NOA (%)', v_emails;
  END IF;
  RAISE NOTICE 'OK 1 — NOA respeita a Caixa de Comunicacao: %', v_emails;

  -- 2. NOB da ACME (container) sai SOMENTE para o TERM-A.
  SELECT count(*) INTO v_n FROM resultado
   WHERE item->>'kind' = 'aviso_atracacao_nob' AND item->>'customer_name' = 'ACME';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: ACME deveria ter exatamente 1 NOB, teve %', v_n; END IF;
  PERFORM 1 FROM resultado
   WHERE item->>'kind' = 'aviso_atracacao_nob' AND item->>'customer_name' = 'ACME'
     AND item->>'terminal_name' = 'TERM-A';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU: NOB da ACME nao saiu no TERM-A'; END IF;
  RAISE NOTICE 'OK 2 — NOB da ACME (container) restrito ao TERM-A';

  -- 3. NOB da BETA (carga solta) sai SOMENTE para o TERM-B.
  SELECT count(*) INTO v_n FROM resultado
   WHERE item->>'kind' = 'aviso_atracacao_nob' AND item->>'customer_name' = 'BETA';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: BETA deveria ter exatamente 1 NOB, teve %', v_n; END IF;
  PERFORM 1 FROM resultado
   WHERE item->>'kind' = 'aviso_atracacao_nob' AND item->>'customer_name' = 'BETA'
     AND item->>'terminal_name' = 'TERM-B';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU: NOB da BETA nao saiu no TERM-B'; END IF;
  RAISE NOTICE 'OK 3 — NOB da BETA (carga solta) restrito ao TERM-B';

  -- 4. A âncora é o UUID da linha de estado, nunca o UUID do terminal.
  PERFORM 1 FROM resultado
   WHERE item->>'kind' = 'aviso_atracacao_nob'
     AND item->>'anchor_atracacao_id' = 'cccccccc-0000-4000-8000-00000000000c'
     AND item->>'customer_name' = 'ACME';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU: ancora do NOB nao e o state_id'; END IF;
  RAISE NOTICE 'OK 4 — NOB ancorado no state_id da Atracacao';

  -- 5. NOB dentro da janela de 30 dias é produzido (TERM-B com ATB de 5 dias atras).
  PERFORM 1 FROM resultado
   WHERE item->>'kind' = 'aviso_atracacao_nob' AND item->>'terminal_name' = 'TERM-B';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FALHOU: NOB do TERM-B nao produzido na janela de 30 dias';
  END IF;
  RAISE NOTICE 'OK 5 — NOB com ATB dentro de 30 dias e comunicado devido';

  -- 6. NOR dentro da janela de 30 dias é produzido (BRVIX com ATA de 5 dias atras).
  PERFORM 1 FROM resultado
   WHERE item->>'kind' = 'aviso_prontidao_nor' AND item->>'port' = 'BRVIX';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FALHOU: NOR de BRVIX nao produzido na janela de 30 dias';
  END IF;
  RAISE NOTICE 'OK 6 — NOR com ATA dentro de 30 dias e comunicado devido';

  -- 7. Guarda de 30 dias descarta marcos com mais de 30 dias (TERM-OLD e BRRIO).
  PERFORM 1 FROM resultado
   WHERE item->>'kind' = 'aviso_atracacao_nob' AND item->>'terminal_name' = 'TERM-OLD';
  IF FOUND THEN
    RAISE EXCEPTION 'FALHOU: NOB com ATB de 45 dias foi produzido — guarda de 30 dias falhou';
  END IF;

  PERFORM 1 FROM resultado
   WHERE item->>'kind' = 'aviso_prontidao_nor' AND item->>'port' = 'BRRIO';
  IF FOUND THEN
    RAISE EXCEPTION 'FALHOU: NOR com ATA de 45 dias foi produzido — guarda de 30 dias falhou';
  END IF;
  RAISE NOTICE 'OK 7 — Guarda de 30 dias barra marcos com mais de 30 dias';

  -- 8. O NOA mantem a sua janela: ela e a definicao do comunicado, nao guarda
  --    de idade. A escala de BRVIX ja passou do ETA, entao nao produz NOA.
  PERFORM 1 FROM resultado
   WHERE item->>'kind' = 'aviso_chegada_noa' AND item->>'port' = 'BRVIX';
  IF FOUND THEN
    RAISE EXCEPTION 'FALHOU: NOA saiu depois do ETA — a janela do NOA foi removida junto';
  END IF;
  RAISE NOTICE 'OK 8 — NOA continua restrito a D-5 ate o ETA';

  RAISE NOTICE '--- TODAS AS ASSERCOES PASSARAM ---';
END $$;

ROLLBACK;
