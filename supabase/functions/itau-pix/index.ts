// Integração Itaú Pix. Chamada só pelo cron e pela equipe técnica, com segredo
// próprio; nunca pelo navegador.
// Corpo vazio (cron) ou {"action":"process_queue"}: processa a fila de cobranças das faturas
// e consulta os recebimentos para a baixa automática.
// Diagnóstico (Fase 1): token, create_test (até R$ 1,00), get, update_test, cancel, list_pix.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { validCleanupAuthorization as validBearer } from "../_shared/ceUnlockCleanupAuth.ts";
import {
  type ChargeQueue, createItauPixClient, ItauPixError, itauPixConfigFromEnv, pollItauPixReceipts, processItauPixQueue,
  runItauPixAction,
} from "../_shared/itauPix.ts";

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
      if (input.action === undefined || input.action === "process_queue") {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const queue: ChargeQueue = {
          async claim(limit) {
            const { data, error } = await admin.rpc("itau_pix_claim", { p_limit: limit });
            if (error) throw new Error("Falha ao reservar a fila Itaú.");
            return data ?? [];
          },
          async record(id, result) {
            const { error } = await admin.rpc("itau_pix_record", {
              p_id: id, p_outcome: result.outcome,
              p_revision: result.outcome === "active" ? result.revision : null,
              p_pix_copia_e_cola: result.outcome === "active" ? result.pixCopiaECola : null,
              p_error: result.outcome === "active" ? null : result.error ?? null,
              p_bank_created_at: result.outcome === "active" ? result.bankCreatedAt : null,
            });
            if (error) throw new Error("Falha ao registrar resultado Itaú.");
          },
        };
        // Prazos (vencimento, renovação, PTAX do dia e Alerta das 14h) antes da fila.
        const { data: maintenance, error: maintenanceError } = await admin.rpc("itau_pix_maintain", {});
        if (maintenanceError) throw new Error("Falha na manutenção dos prazos Itaú.");
        const charges = await processItauPixQueue(client, queue);
        // Recebimentos falham isolados: a fila de cobranças já foi processada.
        const receipts = await pollItauPixReceipts(client, {
          async checkpoint() {
            const { data, error } = await admin.rpc("itau_pix_checkpoint", {});
            if (error) throw new Error("Falha ao ler o checkpoint Itaú.");
            return data;
          },
          async settle(pix) {
            const { data, error } = await admin.rpc("itau_pix_settle", {
              p_end_to_end_id: pix.endToEndId, p_txid: pix.txid, p_amount_brl: Number(pix.valor), p_paid_at: pix.horario,
            });
            if (error) throw new Error("Falha ao registrar recebimento Itaú.");
            return data;
          },
          async saveCheckpoint(until) {
            const { error } = await admin.rpc("itau_pix_checkpoint", { p_polled_until: until });
            if (error) throw new Error("Falha ao salvar o checkpoint Itaú.");
          },
        }).catch((error) => ({ error: error instanceof Error ? error.message : "Falha na consulta de recebimentos" }));
        return Response.json({ maintenance, charges, receipts });
      }
      return Response.json(await runItauPixAction(client, input));
    } catch (error) {
      if (error instanceof ItauPixError)
        return Response.json({ error: error.message, itau_status: error.status, itau_body: error.body }, { status: error.status === 400 ? 400 : 502 });
      return Response.json({ error: error instanceof Error ? error.message : "Falha interna" }, { status: 500 });
    }
  });
