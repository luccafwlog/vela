-- Serializa a autoridade de recuperação com a troca de email e fecha o acesso
-- direto às notificações de usuários desativados. Sem backfill de dados.
BEGIN;

ALTER TABLE public.customer_portal_accounts
  ADD COLUMN recovery_reset_invite_id bigint;

CREATE FUNCTION public.guard_recovery_email_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.recovery_email IS DISTINCT FROM OLD.recovery_email THEN
    IF OLD.recovery_reset_invite_id IS NOT NULL THEN
      RAISE EXCEPTION 'Recuperação de senha em andamento. Tente novamente após sua conclusão.' USING ERRCODE='55000';
    END IF;
    UPDATE public.portal_invites SET status='cancelado', cancelled_reason='Email de Recuperação alterado'
      WHERE account_id=OLD.id AND purpose='recuperacao' AND status='pendente';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_recovery_email_authority() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_recovery_email_authority BEFORE UPDATE OF recovery_email
  ON public.customer_portal_accounts FOR EACH ROW EXECUTE FUNCTION public.guard_recovery_email_authority();

CREATE FUNCTION public.portal_begin_password_reset(p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.customer_portal_accounts; i public.portal_invites;
BEGIN
  SELECT * INTO i FROM public.portal_invites WHERE token_hash=p_token_hash AND purpose='recuperacao';
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.customer_portal_accounts WHERE id=i.account_id FOR UPDATE;
  IF NOT FOUND OR a.auth_user_id IS NULL OR NOT a.active OR a.account_situation <> 'ativo'
    OR a.recovery_reset_invite_id IS NOT NULL THEN RETURN NULL; END IF;
  UPDATE public.portal_invites SET status='consumido', consumed_at=clock_timestamp()
    WHERE id=i.id AND status='pendente' AND expires_at>clock_timestamp()
      AND lower(btrim(sent_to_email))=lower(btrim(a.recovery_email)) RETURNING * INTO i;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- ponytail: falha ambígua no GoTrue exige triagem manual; automatizar somente
  -- com confirmação durável de conclusão, nunca com timeout do marcador.
  UPDATE public.customer_portal_accounts SET recovery_reset_invite_id=i.id WHERE id=a.id;
  RETURN jsonb_build_object('inviteId',i.id,'account',jsonb_build_object(
    'id',a.id,'auth_user_id',a.auth_user_id,'customer_id',a.customer_id,
    'provisioning_decision',a.provisioning_decision,'account_situation',a.account_situation));
END $$;

CREATE FUNCTION public.portal_finish_password_reset(p_account_id bigint,p_invite_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.customer_portal_accounts SET recovery_reset_invite_id=NULL
    WHERE id=p_account_id AND recovery_reset_invite_id=p_invite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recuperação não corresponde à operação em andamento.' USING ERRCODE='55000'; END IF;
END $$;

CREATE FUNCTION public.portal_confirm_recovery_email(p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.customer_portal_accounts; i public.portal_invites;
BEGIN
  SELECT * INTO i FROM public.portal_invites WHERE token_hash=p_token_hash AND purpose='confirmacao_email';
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','link_invalido'); END IF;
  SELECT * INTO a FROM public.customer_portal_accounts WHERE id=i.account_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','link_invalido'); END IF;
  IF a.pending_recovery_email IS NULL THEN RETURN jsonb_build_object('outcome','pedido_ja_resolvido'); END IF;
  IF a.recovery_reset_invite_id IS NOT NULL THEN
    RAISE EXCEPTION 'Recuperação de senha em andamento. Tente novamente após sua conclusão.' USING ERRCODE='55000';
  END IF;
  UPDATE public.portal_invites SET status='consumido', consumed_at=clock_timestamp()
    WHERE id=i.id AND status='pendente' AND expires_at>clock_timestamp()
      AND lower(btrim(sent_to_email))=lower(btrim(a.pending_recovery_email)) RETURNING * INTO i;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','link_invalido'); END IF;
  UPDATE public.customer_portal_accounts SET recovery_email=a.pending_recovery_email,
    pending_recovery_email=NULL,recovery_email_source='informado_manualmente',recovery_email_status='ok' WHERE id=a.id;
  IF a.auth_user_id IS NOT NULL THEN PERFORM public.portal_revoke_sessions(a.auth_user_id); END IF;
  RETURN jsonb_build_object('outcome','aplicar','inviteId',i.id,'account',jsonb_build_object(
    'id',a.id,'customer_id',a.customer_id,'auth_user_id',a.auth_user_id,
    'pending_recovery_email',a.pending_recovery_email,
    'provisioning_decision',a.provisioning_decision,'account_situation',a.account_situation));
END $$;

REVOKE ALL ON FUNCTION public.portal_begin_password_reset(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.portal_finish_password_reset(bigint,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.portal_confirm_recovery_email(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_begin_password_reset(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_finish_password_reset(bigint,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_confirm_recovery_email(text) TO service_role;

ALTER POLICY internal_notifications_select_recipient ON public.internal_notifications
  USING (recipient_id=auth.uid() AND public.is_active_read_user());
ALTER POLICY internal_notifications_update_recipient ON public.internal_notifications
  USING (recipient_id=auth.uid() AND public.is_active_read_user())
  WITH CHECK (recipient_id=auth.uid() AND public.is_active_read_user());
COMMIT;
