import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { validCleanupAuthorization } from "../_shared/ceUnlockCleanupAuth.ts";
import { CE_UNLOCK_BOX, processCeUnlockEmails, type Contact, type OutboxRow } from "../_shared/ceUnlockNotifyEmail.ts";
import { recipientKey, sendEmail } from "../_shared/email.ts";
import { ceUnlockNoticeTemplate } from "../_shared/portalEmailTemplates.ts";
import { canonicalPortalOrigin, portalSupportEmail } from "../_shared/portalUrls.ts";
// Envia a fila de avisos do Desbloqueio de CE (recusa de documento / documentação validada).
// Bearer dedicado e server-only, o mesmo segredo de manutenção do módulo (CE_UNLOCK_CLEANUP_SECRET).
if (typeof Deno !== "undefined")
  Deno.serve(async (req) => {
    const secret = Deno.env.get("CE_UNLOCK_CLEANUP_SECRET");
    if (req.method !== "POST" || !validCleanupAuthorization(req.headers.get("Authorization"), secret))
      return new Response("Acesso negado", { status: 403 });
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("PORTAL_FROM_EMAIL");
    const replyTo = Deno.env.get("PORTAL_REPLY_TO");
    // Sem chave/remetente nada é consumido: as linhas continuam na fila até a configuração existir.
    if (!resendApiKey || !from || !replyTo)
      return new Response("Envio de e-mail não configurado", { status: 503 });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const summary = await processCeUnlockEmails({
      communicationsEnabled: async () => {
        const { data } = await admin.from("app_settings").select("communications_enabled").eq("id", 1).single();
        return Boolean((data as { communications_enabled?: boolean } | null)?.communications_enabled);
      },
      pending: async () => {
        const { data, error } = await admin.rpc("ce_unlock_email_pending", { p_limit: 20 });
        if (error) throw error;
        return (data ?? []) as OutboxRow[];
      },
      contacts: async (customerId) => {
        const { data, error } = await admin.from("customer_contacts").select("id, email").eq("customer_id", customerId);
        if (error) throw error;
        return (data ?? []) as Contact[];
      },
      allowed: async (customerId, contactId) => {
        const { data, error } = await admin.rpc("customer_communication_recipient_allowed", {
          p_customer_id: customerId,
          p_contact_id: contactId,
          p_kind: null,
          p_audience_mode: "caixa",
          p_recipient_box_code: CE_UNLOCK_BOX,
        });
        if (error) throw error;
        return Boolean(data);
      },
      recipientKey,
      send: async ({ row, to, idempotencyKey }) => {
        const mail = ceUnlockNoticeTemplate({
          title: row.subject,
          message: row.body,
          portalUrl: canonicalPortalOrigin(),
          supportEmail: portalSupportEmail(),
        });
        const result = await sendEmail({
          kind: "ce_unlock_notificacao",
          to,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          idempotencyKey,
          resendApiKey,
          from,
          replyTo,
          // Supressão e bounce já foram conferidos por customer_communication_recipient_allowed.
          checkSuppression: async () => ({ suppressed: false }),
          recordAttempt: async ({ idempotencyKey: key }) => ({ id: key, status: "aceito" }),
          updateAttempt: async () => {},
        });
        return result.ok;
      },
      finish: async (id, status, done, error) => {
        const { error: finishError } = await admin.rpc("ce_unlock_email_finish", {
          p_id: id,
          p_status: status,
          p_done: done,
          p_error: error ?? null,
        });
        if (finishError) throw finishError;
      },
    });
    return Response.json(summary);
  });
