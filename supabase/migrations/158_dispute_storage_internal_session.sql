-- Run-2: o upload de Equipamentos consulta Disputes sob RLS. OR/AND não
-- garantem curto-circuito e current_portal_customer_id() lança 28000 para
-- identidades internas. CASE evita exigir sessão Portal de usuário interno,
-- sem ampliar setores, autoria, estado aberto ou escopo do cliente.
ALTER POLICY demurrage_disputes_portal_read ON public.demurrage_disputes
  USING (CASE WHEN public.is_active_user() THEN false
    ELSE customer_id = public.current_portal_customer_id() END);

DO $storage$
BEGIN
  -- O replay local usa shim sem storage.objects; produção tem a política.
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $policy$
      ALTER POLICY demurrage_dispute_objects_read ON storage.objects
      USING (CASE
        WHEN bucket_id <> 'demurrage-disputes' THEN false
        WHEN public.is_active_user() THEN true
        ELSE name LIKE public.current_portal_customer_id()::text || '/%'
      END)
    $policy$;
  END IF;
END;
$storage$;
