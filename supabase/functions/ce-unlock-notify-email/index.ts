import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { validCleanupAuthorization } from "../_shared/ceUnlockCleanupAuth.ts";
import { CE_UNLOCK_BOX, runCeUnlockNotify, type Contact, type OutboxRow } from "../_shared/ceUnlockNotifyEmail.ts";
import { runWithBetterStackHeartbeat } from "../_shared/betterStackHeartbeat.ts";
import { recipientKey } from "../_shared/email.ts";
import { sendPortalEmail } from "../_shared/portalEmail.ts";
import { ceUnlockNoticeTemplate } from "../_shared/portalEmailTemplates.ts";
import { canonicalPortalOrigin, portalSupportEmail } from "../_shared/portalUrls.ts";
import { instrumentEdgeHandler } from "../_shared/telemetry.ts";
// Envia a fila de avisos do Desbloqueio de CE (recusa de documento / documentação validada).
// Com a chave de envio desligada, registra o aviso como simulado (D11). Antes, reavalia a conclusão das solicitações abertas (liquidação não passa por comando do módulo).
// Bearer dedicado e server-only, o mesmo segredo de manutenção do módulo (CE_UNLOCK_CLEANUP_SECRET).
if (typeof Deno !== "undefined") {
  const edgeHandler = instrumentEdgeHandler("ce-unlock-notify-email", async (req) => {
    const secret = Deno.env.get("CE_UNLOCK_CLEANUP_SECRET");
    if (req.method !== "POST" || !validCleanupAuthorization(req.headers.get("Authorization"), secret))
      return new Response("Acesso negado", { status: 403 });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const result = await runCeUnlockNotify({
      refreshOpen: async () => await admin.rpc("ce_unlock_refresh_open"),
      providerConfigured: Boolean(Deno.env.get("RESEND_API_KEY") && Deno.env.get("PORTAL_FROM_EMAIL") && Deno.env.get("PORTAL_REPLY_TO")),
      communicationsEnabled: async () => {
        const { data, error } = await admin.from("app_settings").select("communications_enabled").eq("id", 1).single();
        if (error) throw error;
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
      // Tentativa registrada em portal_email_attempts (também na simulação): o webhook do provedor
      // associa entrega e bounce, e a simulação deixa a lista de quem receberia.
      send: async ({ row, to, idempotencyKey, simulate }) => {
        const mail = ceUnlockNoticeTemplate({
          title: row.subject,
          message: row.body,
          portalUrl: canonicalPortalOrigin(),
          supportEmail: portalSupportEmail(),
        });
        const result = await sendPortalEmail({
          admin,
          kind: "ce_unlock_notificacao",
          to,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          idempotencyKey,
          simulate,
        });
        return result.ok ? "sent" : result.suppressed ? "suppressed" : "failed";
      },
      // A RPC também abre/fecha o alerta desbloqueio_ce_aviso_nao_enviado (migration 307).
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
    return Response.json(result.body, { status: result.status });
  });

  Deno.serve((req) => {
    const authorized = req.method === "POST" &&
      validCleanupAuthorization(req.headers.get("Authorization"), Deno.env.get("CE_UNLOCK_CLEANUP_SECRET"));
    return runWithBetterStackHeartbeat("ceUnlockNotifyEmail", () => edgeHandler(req), { enabled: authorized });
  });
}
