// Integração Itaú Pix. Chamada só pelo cron e pela equipe técnica, com segredo
// próprio; nunca pelo navegador.
// Corpo vazio (cron) ou {"action":"process_queue"}: prazos, fila de cobranças das faturas e
// recebimentos para a baixa automática. {"action":"process_charges"} (disparo da migration
// 219, quando uma cobrança fica pendente): só a fila. A fila roda com a vez única do runner;
// sem ela, a execução não chama o Itaú para cobranças (prazos e recebimentos seguem).
// Diagnóstico (Fase 1): token, create_test (até R$ 1,00), get, update_test, cancel, list_pix.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { validCleanupAuthorization as validBearer } from "../_shared/ceUnlockCleanupAuth.ts";
import {
  type ChargeQueue, createItauPixClient, ItauPixError, itauPixConfigFromEnv, pollItauPixReceipts, processItauPixQueue,
  runItauPixAction,
} from "../_shared/itauPix.ts";

if (typeof Deno !== "undefined")
  Deno.serve(async (req) => {
    // Um segredo por uso (auditoria run-3, decisão do dono de 2026-10-22): a
    // rotina (cron e disparo da fila) usa ITAU_PIX_CRON_SECRET; o diagnóstico
    // da equipe técnica, ITAU_PIX_DIAGNOSTIC_SECRET. ITAU_PIX_ADMIN_SECRET, que
    // servia aos dois, segue aceito na transição.
    // ponytail: apagar ITAU_PIX_ADMIN_SECRET da Edge e do Vault encerra a
    // transição; daí em diante cada uso só aceita o próprio.
    const authorization = req.headers.get("Authorization");
    const legacy = validBearer(authorization, Deno.env.get("ITAU_PIX_ADMIN_SECRET"));
    const routine = legacy || validBearer(authorization, Deno.env.get("ITAU_PIX_CRON_SECRET"));
    const diagnostic = legacy || validBearer(authorization, Deno.env.get("ITAU_PIX_DIAGNOSTIC_SECRET"));
    if (req.method !== "POST" || !(routine || diagnostic))
      return new Response("Acesso negado", { status: 403 });
    let input: Record<string, unknown>;
    try {
      input = await req.json();
    } catch {
      return Response.json({ error: "JSON inválido" }, { status: 400 });
    }
    const routineAction = input.action === undefined || input.action === "process_queue" || input.action === "process_charges";
    if (routineAction ? !routine : !diagnostic) return new Response("Acesso negado", { status: 403 });
    try {
      const config = itauPixConfigFromEnv((name) => Deno.env.get(name));
      const httpClient = Deno.createHttpClient({ cert: config.certPem, key: config.keyPem });
      const client = createItauPixClient(config, (url, init) => fetch(url, { ...init, client: httpClient }));
      const chargesOnly = input.action === "process_charges";
      if (input.action === undefined || input.action === "process_queue" || chargesOnly) {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const workerId = `itau-pix:${crypto.randomUUID()}`;
        const acquire = async () => {
          const { data, error } = await admin.rpc("acquire_itau_pix_runner", { p_worker_id: workerId, p_lease_seconds: 120 });
          if (error) throw new Error("Falha ao obter a vez do runner Itaú.");
          return data === true;
        };
        const queue: ChargeQueue = {
          // Falha ao renovar encerra a fila desta execução; a vez vence sozinha.
          renew: () => acquire().catch(() => false),
          async claim(limit) {
            const { data, error } = await admin.rpc("itau_pix_claim", { p_limit: limit });
            if (error) throw new Error("Falha ao reservar a fila Itaú.");
            return data ?? [];
          },
          async record(id, result, claimedVersion) {
            const { error } = await admin.rpc("itau_pix_record", {
              p_id: id, p_outcome: result.outcome,
              p_revision: result.outcome === "active" ? result.revision : null,
              p_pix_copia_e_cola: result.outcome === "active" ? result.pixCopiaECola : null,
              p_error: result.outcome === "active" ? null : result.error ?? null,
              p_bank_created_at: result.outcome === "active" ? result.bankCreatedAt : null,
              p_claimed_version: claimedVersion ?? null,
            });
            if (error) throw new Error("Falha ao registrar resultado Itaú.");
          },
          async release(ids) {
            const { error } = await admin.rpc("itau_pix_release", { p_ids: ids });
            if (error) throw new Error("Falha ao liberar a reserva Itaú.");
          },
        };
        const runCharges = async () => {
          // Outra execução tem a vez: as cobranças entram no bloco seguinte dela ou no próximo minuto.
          if (!(await acquire())) return { skipped: "busy" as const };
          try {
            return await processItauPixQueue(client, queue);
          } finally {
            const { error } = await admin.rpc("release_itau_pix_runner", { p_worker_id: workerId });
            // Sem a devolução, a vez vence sozinha em 120 s.
            if (error) console.error("itau-pix: devolução da vez falhou", error);
          }
        };
        if (chargesOnly) return Response.json({ charges: await runCharges() });
        // Prazos (vencimento, renovação, PTAX do dia e Alerta das 14h) antes da fila.
        const { data: maintenance, error: maintenanceError } = await admin.rpc("itau_pix_maintain", {});
        if (maintenanceError) throw new Error("Falha na manutenção dos prazos Itaú.");
        // A fila falha isolada (vez, reserva, registro): os recebimentos seguem neste minuto.
        const charges = await runCharges().catch((error) => {
          console.error("itau-pix: fila de cobranças falhou", error);
          return { error: error instanceof Error ? error.message : "Falha na fila de cobranças" };
        });
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
          async failed(pix, message, permanent) {
            const { data, error } = await admin.rpc("itau_pix_receipt_failed", {
              p_end_to_end_id: pix.endToEndId ?? null, p_txid: pix.txid, p_raw: pix.raw, p_error: message, p_permanent: permanent,
            });
            if (error) throw new Error("Falha ao registrar recebimento Itaú com erro.");
            return data;
          },
          async untracked(pix) {
            const { data, error } = await admin.rpc("itau_pix_record_untracked", {
              p_end_to_end_id: pix.endToEndId, p_amount_brl: Number(pix.valor), p_paid_at: pix.horario,
            });
            if (error) throw new Error("Falha ao registrar Pix sem TXID.");
            return data;
          },
          async saveCheckpoint(until) {
            const { error } = await admin.rpc("itau_pix_checkpoint", { p_polled_until: until });
            if (error) throw new Error("Falha ao salvar o checkpoint Itaú.");
          },
        }).catch((error) => {
          // A parada por fuso leva os TXIDs que divergiram: ficam no log e na resposta.
          const detail = error instanceof ItauPixError ? error.body : null;
          console.error("itau-pix receipts", error instanceof Error ? error.message : error, detail);
          return { error: error instanceof Error ? error.message : "Falha na consulta de recebimentos", detail };
        });
        // Falha da fila ou da consulta responde fora de 2xx: o Alerta rotina_http_falhou
        // (migration 310) só enxerga o status (F-09).
        const failed = "error" in charges || "error" in receipts;
        return Response.json({ maintenance, charges, receipts }, { status: failed ? 500 : 200 });
      }
      return Response.json(await runItauPixAction(client, input));
    } catch (error) {
      if (error instanceof ItauPixError)
        return Response.json({ error: error.message, itau_status: error.status, itau_body: error.body }, { status: error.status === 400 ? 400 : 502 });
      return Response.json({ error: error instanceof Error ? error.message : "Falha interna" }, { status: 500 });
    }
  });
