import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import * as XLSX from "npm:@e965/xlsx@0.20.3";
import { withCors } from "../_shared/cors.ts";
import { zptRows } from "../../../src/services/ceUnlockRules.ts";
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
      let result;
      if (body.export_id) {
        const list = await user.rpc("ce_unlock_read", {
          p_kind: "exports",
          p_payload: {},
        });
        if (list.error) return json({ error: "Acesso negado" }, 403);
        result = {
          data: list.data.find((e: { id: string }) => e.id === body.export_id),
          error: null,
        };
      } else
        result = await user.rpc("ce_unlock_command", {
          p_action: "export",
          p_payload: body,
        });
      if (result.error || !result.data)
        return json(
          { error: result.error?.message ?? "Lote não encontrado" },
          422,
        );
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(zptRows(result.data.rows, result.data.layout_version)),
        "Desbloqueio CE",
      );
      const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" });
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="zpt-${result.data.id}.xlsx"`,
          "X-CE-Export-Id": result.data.id,
        },
      });
    }),
  );
