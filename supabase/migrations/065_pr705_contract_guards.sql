-- PR 705: keep the ADR label contract and empty-container export timeline
-- invariant at the database boundary.

CREATE OR REPLACE FUNCTION public.agency_report_section_label(p_section TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_section
    WHEN 'datas' THEN 'Escala'
    WHEN 'carga_descarregada' THEN 'Carga descarregada'
    WHEN 'carga_carregada' THEN 'Carga carregada'
    WHEN 'veiculos' THEN 'Veículos'
    WHEN 'vazios_embarcados' THEN 'Embarque de vazios'
    WHEN 'vazios_descarregados' THEN 'Vazios descarregados'
    WHEN 'operacao_patio' THEN 'Operação de pátio'
    WHEN 'ocorrencias' THEN 'Ocorrências'
    ELSE p_section
  END;
$$;

-- Keep legacy rows readable while rejecting every new or updated booking whose
-- movement happens before the depot released the container.
ALTER TABLE public.vazios_bookings
  ADD CONSTRAINT vazios_bookings_movement_after_hand_out
  CHECK (
    movement_date IS NULL
    OR hand_out_date IS NULL
    OR movement_date >= hand_out_date
  ) NOT VALID;
