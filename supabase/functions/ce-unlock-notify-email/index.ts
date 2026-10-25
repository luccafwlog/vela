import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { validDedicatedAuthorization } from "../_shared/ceUnlockCleanupAuth.ts";
import { CE_UNLOCK_BOX, ceUnlockNoticeBls, runCeUnlockNotify, type Contact, type OutboxRow } from "../_shared/ceUnlockNotifyEmail.ts";
import { runCronWithBetterStackHeartbeat } from "../_shared/betterStackHeartbeat.ts";
import { recipientKey } from "../_shared/email.ts";
import { sendPortalEmail } from "../_shared/portalEmail.ts";
import { ceUnlockNoticeTemplate } from "../_shared/portalEmailTemplates.ts";
import { canonicalPortalOrigin, portalSupportEmail } from "../_shared/portalUrls.ts";
import { instrumentEdgeHandler } from "../_shared/telemetry.ts";
// Envia a fila de avisos do Desbloqueio de CE (recusa de documento / documentação validada).
// Com a chave de envio desligada, registra o aviso como simulado (D11). Antes, reavalia a conclusão das solicitações abertas (liquidação não passa por comando do módulo).
// Bearer dedicado e server-only: CE_UNLOCK_NOTIFY_SECRET. O do expurgo
// (CE_UNLOCK_CLEANUP_SECRET) vale até CE_UNLOCK_NOTIFY_SHARED_RETIRED=true (auditoria run-3).
function notifyAuthorized(header: string | null): boolean {
  return validDedicatedAuthorization(
    header,
    Deno.env.get("CE_UNLOCK_NOTIFY_SECRET"),
    Deno.env.get("CE_UNLOCK_CLEANUP_SECRET"),
    Deno.env.get("CE_UNLOCK_NOTIFY_SHARED_RETIRED") === "true",
  );
}

if (typeof Deno !== "undefined") {
  const edgeHandler = instrumentEdgeHandler("ce-unlock-notify-email", async (req) => {
    if (req.method !== "POST" || !notifyAuthorized(req.headers.get("Authorization")))
      return new Response("Acesso negado", { status: 403 });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Protocolo e B/Ls da solicitação, para o bloco "Solicitação" do e-mail: uma leitura por solicitação.
    const requestCache = new Map<string, Promise<{ protocol: string; bls: string[] }>>();
    const requestDetails = (requestId: string) => {
      let cached = requestCache.get(requestId);
      if (!cached) {
        cached = (async () => {
          const [request, items, moved] = await Promise.all([
            admin.from("ce_unlock_requests").select("protocol, customer_id").eq("id", requestId).maybeSingle(),
            admin.from("ce_unlock_request_bls").select("bl_id").eq("request_id", requestId).order("bl_id"),
            admin.from("ce_unlock_events").select("bl_id").eq("request_id", requestId).eq("action", "bl_moved"),
          ]);
          if (request.error) throw request.error;
          if (items.error) throw items.error;
          if (moved.error) throw moved.error;
          const requestRow = request.data as { protocol?: string; customer_id?: number } | null;
          const itemRows = (items.data ?? []) as Array<{ bl_id: string }>;
          // Só B/L que ainda é do Cliente da solicitação, como a visão do Portal (request_json).
          const owned = itemRows.length && requestRow?.customer_id != null
            ? await admin.from("bls").select("id").in("id", itemRows.map((item) => item.bl_id)).eq("customer_id", requestRow.customer_id)
            : { data: [], error: null };
          if (owned.error) throw owned.error;
          return {
            protocol: requestRow?.protocol ?? "",
            bls: ceUnlockNoticeBls(
              itemRows,
              (moved.data ?? []) as Array<{ bl_id: string | null }>,
              ((owned.data ?? []) as Array<{ id: string }>).map((bl) => bl.id),
            ),
          };
        })();
        requestCache.set(requestId, cached);
      }
      return cached;
    };
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
        if (data) return "allowed";
        // A RPC também recusa o contato suprimido; separa esse caso para o aviso fechar parcial
        // e o alerta não dizer que falta contato quando ele existe e foi devolvido.
        const { data: contact, error: contactError } = await admin.from("customer_contacts")
          .select("email_normalized, deactivated_at").eq("id", contactId).eq("customer_id", customerId).maybeSingle();
        if (contactError) throw contactError;
        const found = contact as { email_normalized: string | null; deactivated_at: string | null } | null;
        const email = found && !found.deactivated_at ? found.email_normalized : null;
        if (!email) return "blocked";
        const { data: link, error: linkError } = await admin.from("customer_contact_box_links")
          .select("contact_id").eq("contact_id", contactId).eq("box_code", CE_UNLOCK_BOX).maybeSingle();
        if (linkError) throw linkError;
        if (!link) return "blocked";
        const [bounce, complaint] = await Promise.all([
          admin.from("portal_suppressed_emails").select("id").eq("email", email).eq("reason", "bounce_permanente").maybeSingle(),
          admin.from("customer_communication_suppressions").select("id").eq("email", email).maybeSingle(),
        ]);
        if (bounce.error) throw bounce.error;
        if (complaint.error) throw complaint.error;
        return bounce.data || complaint.data ? "suppressed" : "blocked";
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
          request: await requestDetails(row.request_id),
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

  // O gatilho da fila (migration 456) manda {"source":"trigger"}: roda igual e reporta só a falha.
  Deno.serve((req) => {
    const authorized = req.method === "POST" && notifyAuthorized(req.headers.get("Authorization"));
    return runCronWithBetterStackHeartbeat("ceUnlockNotifyEmail", req, authorized, () => edgeHandler(req));
  });
}
