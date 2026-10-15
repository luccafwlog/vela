// Expurgo diário contra um backend HTTP falso: falha física no Storage não marca
// o documento como expurgado, e a rodada seguinte tenta de novo. Sem escrita remota.
let handler: (req: Request) => Promise<Response>;
const serve = Deno.serve;
Deno.serve = ((callback: typeof handler) => { handler = callback; }) as typeof Deno.serve;
try {
  await import("./index.ts");
} finally {
  Deno.serve = serve;
}

async function cleanupRun(options: { storageFails: boolean; claimed?: boolean }) {
  const originalFetch = globalThis.fetch;
  const variables = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CE_UNLOCK_CLEANUP_SECRET"];
  const previous = variables.map(name => Deno.env.get(name));
  Deno.env.set(variables[0], "https://ce-cleanup.example.test");
  Deno.env.set(variables[1], "test-service");
  Deno.env.set(variables[2], "test-secret");
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    calls.push(path);
    let value: unknown = null;
    let status = 200;
    if (path.endsWith("ce_unlock_cleanup_candidates")) value = [{ id: "doc-1", storage_path: "1/doc-1.pdf" }];
    else if (path.endsWith("ce_unlock_cleanup_claim")) value = options.claimed === false ? null : { id: "doc-1", storage_path: "1/doc-1.pdf" };
    else if (path === "/storage/v1/object/ce-unlock-documents") {
      value = options.storageFails ? { statusCode: "503", error: "Unavailable", message: "Storage unavailable" } : [{ name: "1/doc-1.pdf" }];
      status = options.storageFails ? 503 : 200;
    } else if (path.endsWith("ce_unlock_cleanup_record")) value = null;
    else if (path.endsWith("ce_unlock_expire_drafts")) value = 0;
    else throw new Error(`Unexpected backend call: ${path}`);
    return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await handler(new Request("https://function.example.test", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }));
    const body = response.status === 200 ? await response.json() : await response.text();
    return { status: response.status, body, calls };
  } finally {
    globalThis.fetch = originalFetch;
    variables.forEach((name, index) => previous[index] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[index]!));
  }
}
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("falha física no Storage não registra o expurgo; a rodada seguinte remove", async () => {
  const failed = await cleanupRun({ storageFails: true });
  assert(failed.status === 200, `Status inesperado: ${failed.status}`);
  assert((failed.body as { removed: number }).removed === 0, "Contou como removido sem apagar o objeto");
  assert(!failed.calls.some(path => path.endsWith("ce_unlock_cleanup_record")), "Registrou purged_at sem apagar o objeto");
  // O documento continua reivindicado (cleanup_claimed_at) e volta como candidato na próxima rodada.
  const retried = await cleanupRun({ storageFails: false });
  assert((retried.body as { removed: number }).removed === 1, "Nova tentativa não removeu");
  assert(retried.calls.some(path => path.endsWith("ce_unlock_cleanup_record")), "Nova tentativa não registrou o expurgo");
});
Deno.test("documento que outra rodada já reivindicou não é apagado de novo", async () => {
  const result = await cleanupRun({ storageFails: false, claimed: false });
  assert((result.body as { removed: number }).removed === 0, "Contou remoção sem reivindicação");
  assert(!result.calls.includes("/storage/v1/object/ce-unlock-documents"), "Apagou objeto sem reivindicar");
});
Deno.test("sem o segredo de manutenção, nada é consultado", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("null"); };
  Deno.env.set("CE_UNLOCK_CLEANUP_SECRET", "test-secret");
  try {
    const response = await handler(new Request("https://function.example.test", { method: "POST", headers: { Authorization: "Bearer outro" } }));
    await response.text();
    assert(response.status === 403, `Status inesperado: ${response.status}`);
    assert(!called, "Consultou o banco sem autorização");
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("CE_UNLOCK_CLEANUP_SECRET");
  }
});
