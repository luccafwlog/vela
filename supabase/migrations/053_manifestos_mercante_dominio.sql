-- 053: Modelo de Dominio do Manifesto Mercante e vinculo de B/Ls
--
-- Conforme spec docs/spec/2026-09-17-manifesto-mercante-design.md:
--   1. Manifesto Mercante e um lancamento com numero unico global, par de portos e natureza.
--   2. O B/L aponta para seu manifesto Mercante via bls.manifesto_mercante_id.
--   3. Vazios de exportacao passam a ter par de portos (pol/pod) em vazios_bookings.

CREATE TABLE IF NOT EXISTS public.manifestos_mercante (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    voyage_id bigint NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
    pol text NOT NULL,
    pod text NOT NULL,
    numero text NOT NULL,
    natureza text NOT NULL CHECK (natureza IN ('carga', 'vazio')),
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT manifestos_mercante_numero_uniq UNIQUE (numero)
);

CREATE INDEX IF NOT EXISTS idx_manifestos_mercante_voyage_rota 
  ON public.manifestos_mercante(voyage_id, pol, pod);

ALTER TABLE public.bls 
ADD COLUMN IF NOT EXISTS manifesto_mercante_id uuid REFERENCES public.manifestos_mercante(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bls_manifesto_mercante 
  ON public.bls(manifesto_mercante_id);

ALTER TABLE public.vazios_bookings
ADD COLUMN IF NOT EXISTS pol text,
ADD COLUMN IF NOT EXISTS pod text;

-- RLS e permissoes
ALTER TABLE public.manifestos_mercante ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'manifestos_mercante' AND policyname = 'manifestos_mercante_read_policy'
  ) THEN
    CREATE POLICY manifestos_mercante_read_policy ON public.manifestos_mercante
      FOR SELECT TO authenticated USING (public.is_active_read_user());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'manifestos_mercante' AND policyname = 'manifestos_mercante_write_policy'
  ) THEN
    CREATE POLICY manifestos_mercante_write_policy ON public.manifestos_mercante
      FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());
  END IF;
END $$;

GRANT ALL ON public.manifestos_mercante TO authenticated, service_role;
