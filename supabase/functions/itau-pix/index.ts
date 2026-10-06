// Fase 1 da integração Itaú Pix: diagnóstico e prova de centavos.
// Chamada só pelo dono/equipe técnica com segredo próprio; nunca pelo navegador.
// Ações: token, create_test (até R$ 1,00), get, update_test, cancel, list_pix.
import { validCleanupAuthorization as validBearer } from "../_shared/ceUnlockCleanupAuth.ts";
import { createItauPixClient, ItauPixError, itauPixConfigFromEnv, runItauPixAction } from "../_shared/itauPix.ts";

if (typeof Deno !== "undefined")
  Deno.serve(async (req) => {
    if (req.method !== "POST" || !validBearer(req.headers.get("Authorization"), Deno.env.get("ITAU_PIX_ADMIN_SECRET")))
      return new Response("Acesso negado", { status: 403 });
    let input: Record<string, unknown>;
    try {
      input = await req.json();
    } catch {
      return Response.json({ error: "JSON inválido" }, { status: 400 });
    }
    try {
      const config = itauPixConfigFromEnv((name) => Deno.env.get(name));
      const httpClient = Deno.createHttpClient({ cert: config.certPem, key: config.keyPem });
      const client = createItauPixClient(config, (url, init) => fetch(url, { ...init, client: httpClient }));
      return Response.json(await runItauPixAction(client, input));
    } catch (error) {
      if (error instanceof ItauPixError)
        return Response.json({ error: error.message, itau_status: error.status, itau_body: error.body }, { status: error.status === 400 ? 400 : 502 });
      return Response.json({ error: "Falha interna" }, { status: 500 });
    }
  });
