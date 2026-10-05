import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { validCleanupAuthorization } from "../_shared/ceUnlockCleanupAuth.ts";
// Dedicated server-only maintenance bearer, never a browser or service-role token.
if (typeof Deno !== "undefined")
  Deno.serve(async (req) => {
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const secret = Deno.env.get("CE_UNLOCK_CLEANUP_SECRET");
    if (
      req.method !== "POST" ||
      !validCleanupAuthorization(req.headers.get("Authorization"), secret)
    )
      return new Response("Acesso negado", { status: 403 });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, key);
    const { data, error } = await admin.rpc("ce_unlock_cleanup_candidates");
    if (error)
      return new Response("Falha na consulta de expurgo", { status: 500 });
    let removed = 0;
    for (const candidate of data ?? []) {
      const { data: d, error: claimError } = await admin.rpc("ce_unlock_cleanup_claim", { p_document_id: candidate.id });
      if (claimError || !d) continue;
      const deleted = await admin.storage
        .from("ce-unlock-documents")
        .remove([d.storage_path]);
      if (deleted.error) continue;
      const expired = await admin.rpc("ce_unlock_cleanup_record", {
        p_document_id: d.id,
      });
      if (!expired.error) removed++;
    }
    const { data: expiredDrafts, error: expireError } = await admin.rpc("ce_unlock_expire_drafts");
    if (expireError) return new Response("Falha ao expirar rascunhos", { status: 500 });
    return Response.json({ removed, expired_drafts: expiredDrafts });
  });
