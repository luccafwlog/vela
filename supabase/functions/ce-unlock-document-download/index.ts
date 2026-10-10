import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { withCors } from "../_shared/cors.ts";
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
      const body = await req.json().catch(() => ({}));
      const access = await user.rpc("ce_unlock_document_access", {
        p_document_id: body.document_id,
      });
      if (access.error) return json({ error: "Documento não autorizado" }, 403);
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      // Baixa com o nome enviado (ex.: o modelo .docx do desk), não com o caminho interno.
      const doc = await admin
        .from("ce_unlock_documents")
        .select("file_name")
        .eq("storage_path", access.data)
        .maybeSingle();
      const link = await admin.storage
        .from("ce-unlock-documents")
        .createSignedUrl(access.data, 60, { download: doc.data?.file_name || true });
      if (link.error) return json({ error: "Documento indisponível" }, 404);
      return json({ url: link.data.signedUrl, expiresIn: 60 });
    }),
  );
