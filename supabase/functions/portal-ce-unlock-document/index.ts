import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { withCors } from "../_shared/cors.ts";
import { readCeMultipart, validateCePdf } from "../_shared/ceUnlockFile.ts";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
if (typeof Deno !== "undefined")
  Deno.serve(
    withCors(async (req) => {
      if (req.method !== "POST") return json({ error: "Método inválido" }, 405);
      const user = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        {
          global: {
            headers: { Authorization: req.headers.get("Authorization") ?? "" },
          },
        },
      );
      const auth = await user.auth.getUser();
      if (auth.error || !auth.data.user)
        return json({ error: "Sessão inválida" }, 401);
      let form: FormData;
      try {
        form = await readCeMultipart(req);
      } catch {
        return json({ error: "PDF inválido ou acima de 10 MiB" }, 413);
      }
      const file = form.get("file");
      if (!file || typeof file === "string")
        return json({ error: "PDF obrigatório" }, 422);
      let context: Record<string, unknown>;
      try {
        context = JSON.parse(String(form.get("context")));
      } catch {
        return json({ error: "Contexto inválido" }, 422);
      }
      const reserved = await user.rpc("ce_unlock_prepare_upload", {
        p_context: { ...context, file_name: file.name, size_bytes: file.size },
      });
      if (reserved.error)
        return json(
          { error: reserved.error.message },
          reserved.error.code === "42501" ? 403 : 422,
        );
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        validateCePdf(file.name, file.type, bytes);
      } catch {
        return json({ error: "Use PDF válido de até 10 MiB" }, 422);
      }
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const path = reserved.data.storage_path;
      const stored = await admin.storage
        .from("ce-unlock-documents")
        .upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (stored.error) return json({ error: "Falha ao armazenar PDF" }, 500);
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const result = await user.rpc("ce_unlock_finish_upload", {
        p_document_id: reserved.data.id,
        p_hash: hash,
      });
      if (result.error) {
        // Claim only a still-pending upload; finish may have committed despite a lost response.
        const aborted = await admin.rpc("ce_unlock_abort_upload", {
          p_document_id: reserved.data.id,
        });
        if (!aborted.error && aborted.data) {
          const removed = await admin.storage
            .from("ce-unlock-documents")
            .remove([aborted.data]);
          if (!removed.error)
            await admin.rpc("ce_unlock_cleanup_record", {
              p_document_id: reserved.data.id,
            });
        }
        return json({ error: result.error.message }, 422);
      }
      return json(result.data, 201);
    }),
  );
