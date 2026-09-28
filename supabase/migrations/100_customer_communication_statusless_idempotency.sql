-- 100: o status do cabeçalho é uma projeção mutável das tentativas e não faz
-- parte da identidade lógica do comunicado. Os dispatches e discriminadores
-- continuam separando comunicações realmente distintas.
-- Preflight: falhar sem alterar linhas se identidades duplicadas surgirem entre
-- statuses; a operação deve reconciliar tentativas/referências antes do retry.

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.customer_communications
    GROUP BY
      kind,
      customer_id,
      anchor_voyage_id,
      anchor_port,
      anchor_atracacao_id,
      anchor_invoice_id,
      dispatch_id,
      attempt_discriminator
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'customer_communications has duplicate logical identities without status; reconcile before migration';
  END IF;
END;
$migration$;

DROP INDEX IF EXISTS public.customer_communications_idempotency;

CREATE UNIQUE INDEX customer_communications_idempotency
  ON public.customer_communications (
    kind,
    customer_id,
    anchor_voyage_id,
    anchor_port,
    anchor_atracacao_id,
    anchor_invoice_id,
    dispatch_id,
    attempt_discriminator
  ) NULLS NOT DISTINCT;
