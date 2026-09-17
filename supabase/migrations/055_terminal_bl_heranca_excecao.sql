-- 055: Terminal do B/L herdado da Frente de Operacao, com excecao individual auditada (ADR 0068)
--
-- Conforme ADR 0068 e spec docs/spec/2026-09-16-unificacao-bls-carga-mista-design.md:
--   1. bls ganha pod_port_id e terminal_id com FK composta para depots(id, port_id).
--   2. Funcao resolve_bl_terminal_id resolve o terminal do B/L com precedencia da excecao.
--   3. bl_operation_front_modalidade trata 'misto' explicitamente.
--   4. Pendencias de revisao: mixed_bl_terminal_conflict e bl_terminal_sem_frente.

-- 1. Colunas de terminal e ancora de porto com FK composta
ALTER TABLE public.bls
ADD COLUMN IF NOT EXISTS pod_port_id bigint REFERENCES public.ports(id),
ADD COLUMN IF NOT EXISTS terminal_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bls_terminal_pod_port_fk' AND conrelid = 'public.bls'::regclass
  ) THEN
    ALTER TABLE public.bls
    ADD CONSTRAINT bls_terminal_pod_port_fk
    FOREIGN KEY (terminal_id, pod_port_id) REFERENCES public.depots(id, port_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bls_terminal_id_fkey' AND conrelid = 'public.bls'::regclass
  ) THEN
    ALTER TABLE public.bls
    ADD CONSTRAINT bls_terminal_id_fkey
    FOREIGN KEY (terminal_id) REFERENCES public.depots(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bls_terminal_pod_port ON public.bls(terminal_id, pod_port_id);

-- 2. bl_operation_front_modalidade tratando 'misto' como 'carga_cheia' para casar com frentes existentes
CREATE OR REPLACE FUNCTION public.bl_operation_front_modalidade(p_cargo_mode text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(btrim(COALESCE(p_cargo_mode, '')))
    WHEN 'carga_solta' THEN 'carga_solta'
    WHEN 'misto' THEN 'carga_cheia'
    WHEN 'veiculo' THEN 'veiculo'
    WHEN 'veiculos' THEN 'veiculo'
    ELSE 'carga_cheia'
  END;
$$;

-- 3. Funcao de resolucao unica de terminal do B/L
CREATE OR REPLACE FUNCTION public.resolve_bl_terminal_id(p_bl_id text)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl record;
  v_term_cntr uuid;
  v_term_bb uuid;
BEGIN
  SELECT id, voyage_id, pod, cargo_mode, terminal_id, pod_port_id
  INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 1. Precedencia total da excecao individual
  IF v_bl.terminal_id IS NOT NULL THEN
    RETURN v_bl.terminal_id;
  END IF;

  -- 2. Heranca da Frente de Operacao
  IF v_bl.cargo_mode = 'container' THEN
    SELECT terminal_id INTO v_term_cntr
    FROM public.voyage_escala_operation_fronts
    WHERE voyage_id = v_bl.voyage_id 
      AND port = v_bl.pod 
      AND sentido = 'importacao' 
      AND modalidade = 'carga_cheia'
    LIMIT 1;
    RETURN v_term_cntr;

  ELSIF v_bl.cargo_mode = 'carga_solta' THEN
    SELECT terminal_id INTO v_term_bb
    FROM public.voyage_escala_operation_fronts
    WHERE voyage_id = v_bl.voyage_id 
      AND port = v_bl.pod 
      AND sentido = 'importacao' 
      AND modalidade = 'carga_solta'
    LIMIT 1;
    RETURN v_term_bb;

  ELSIF v_bl.cargo_mode = 'misto' THEN
    SELECT terminal_id INTO v_term_cntr
    FROM public.voyage_escala_operation_fronts
    WHERE voyage_id = v_bl.voyage_id 
      AND port = v_bl.pod 
      AND sentido = 'importacao' 
      AND modalidade = 'carga_cheia'
    LIMIT 1;

    SELECT terminal_id INTO v_term_bb
    FROM public.voyage_escala_operation_fronts
    WHERE voyage_id = v_bl.voyage_id 
      AND port = v_bl.pod 
      AND sentido = 'importacao' 
      AND modalidade = 'carga_solta'
    LIMIT 1;

    -- Em B/L misto, se ambas as frentes apontam para o mesmo terminal, herda esse terminal
    IF v_term_cntr IS NOT NULL AND v_term_cntr = v_term_bb THEN
      RETURN v_term_cntr;
    ELSE
      -- Frentes divergentes sem excecao individual -> conflito (retorna NULL)
      RETURN NULL;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- 4. Verificacao de pendencias de terminal em B/L
CREATE OR REPLACE FUNCTION public.check_bl_terminal_pendencies(p_bl_id text)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl record;
  v_term_cntr uuid;
  v_term_bb uuid;
  v_front_exists boolean;
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  SELECT id, voyage_id, pod, cargo_mode, terminal_id
  INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RETURN v_reasons;
  END IF;

  IF v_bl.terminal_id IS NOT NULL THEN
    -- Excecao existe: verificar se ha frente planejada para aquele terminal na escala
    SELECT EXISTS (
      SELECT 1 FROM public.voyage_escala_operation_fronts
      WHERE voyage_id = v_bl.voyage_id 
        AND port = v_bl.pod 
        AND terminal_id = v_bl.terminal_id
    ) INTO v_front_exists;

    IF NOT v_front_exists THEN
      v_reasons := array_append(v_reasons, 'review:bl_terminal_sem_frente');
    END IF;
  ELSE
    -- Sem excecao: se for misto, verificar se as frentes de contêiner e carga solta conflitam
    IF v_bl.cargo_mode = 'misto' THEN
      SELECT terminal_id INTO v_term_cntr
      FROM public.voyage_escala_operation_fronts
      WHERE voyage_id = v_bl.voyage_id 
        AND port = v_bl.pod 
        AND sentido = 'importacao' 
        AND modalidade = 'carga_cheia'
      LIMIT 1;

      SELECT terminal_id INTO v_term_bb
      FROM public.voyage_escala_operation_fronts
      WHERE voyage_id = v_bl.voyage_id 
        AND port = v_bl.pod 
        AND sentido = 'importacao' 
        AND modalidade = 'carga_solta'
      LIMIT 1;

      IF v_term_cntr IS DISTINCT FROM v_term_bb OR v_term_cntr IS NULL THEN
        v_reasons := array_append(v_reasons, 'review:mixed_bl_terminal_conflict');
      END IF;
    END IF;
  END IF;

  RETURN v_reasons;
END;
$$;
