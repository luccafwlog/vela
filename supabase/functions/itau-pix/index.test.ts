// Rodada do job itau-pix-queue contra um banco, um Itaú e um Sentry falsos
// (fetch substituído): sem chamada remota. Reproduz o 500 de 22/10/2026 (v29):
// rodada sem nenhuma falha respondia 500, sem log nem evento no Sentry.
let handler: (req: Request) => Promise<Response>;
const serve = Deno.serve;
Deno.serve = ((callback: typeof handler) => { handler = callback; }) as typeof Deno.serve;
try {
  await import("./index.ts");
} finally {
  Deno.serve = serve;
}

const SENTRY_HOST = "sentry.example.test";
const env: Record<string, string> = {
  SUPABASE_URL: "https://itau-pix.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  ITAU_PIX_CRON_SECRET: "test-cron-secret",
  ITAU_CLIENT_ID: "test-client-id",
  ITAU_CLIENT_SECRET: "test-client-secret",
  ITAU_PIX_KEY: "test-pix-key",
  ITAU_CERT_B64: btoa("test-cert"),
  ITAU_KEY_B64: btoa("test-key"),
  ITAU_PIX_BASE_URL: "https://pix.itau.example.test/v2",
  ITAU_TOKEN_URL: "https://sts.itau.example.test/token",
};
const unset = ["ITAU_PIX_ADMIN_SECRET", "ITAU_PIX_DIAGNOSTIC_SECRET", "SENTRY_DSN"];

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

// Cobrança na fila; o Itaú responde 429 à criação, o que para a fila no meio do bloco.
const queued = (id: number) => ({
  id, txid: `VELA${String(id).padStart(28, "0")}`, amount_brl: "10.00", expiration_seconds: 3600,
  status: "pending_create", uncertain: false, attempts: 1, change_version: 1,
});

async function routineRun(options: { failRpc?: string; busy?: boolean; claimed?: unknown[] } = {}) {
  const originalFetch = globalThis.fetch;
  const originalHttpClient = Deno.createHttpClient;
  const originalConsoleError = console.error;
  const names = [...Object.keys(env), ...unset];
  const previous = names.map((name) => Deno.env.get(name));
  for (const name of unset) Deno.env.delete(name);
  for (const [name, value] of Object.entries(env)) Deno.env.set(name, value);
  // O evento só sai com DSN; o falso aponta para o fetch abaixo.
  Deno.env.set("SENTRY_DSN", `https://public@${SENTRY_HOST}/1`);
  const rpcs: string[] = [];
  const sentry: string[] = [];
  const logs: unknown[][] = [];
  // Certificado fictício: o cliente mTLS real recusaria o PEM.
  Deno.createHttpClient = (() => ({ close() {} })) as unknown as typeof Deno.createHttpClient;
  console.error = (...args: unknown[]) => { logs.push(args); };
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = typeof init?.body === "string" ? init.body : "";
    if (url.hostname === SENTRY_HOST) {
      sentry.push(body);
      return json({});
    }
    if (url.href === env.ITAU_TOKEN_URL) return json({ access_token: "test-token", token_type: "Bearer", expires_in: 300 });
    if (url.href.startsWith(`${env.ITAU_PIX_BASE_URL}/pix?`)) {
      return json({ pix: [], parametros: { paginacao: { quantidadeDePaginas: 1, quantidadeTotalDeItens: 0 } } });
    }
    if (url.href.startsWith(`${env.ITAU_PIX_BASE_URL}/cob/`)) return json({ title: "Too Many Requests" }, 429);
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1];
    if (url.origin !== env.SUPABASE_URL || !rpc) throw new Error(`Chamada inesperada: ${url.href}`);
    rpcs.push(rpc);
    if (rpc === options.failRpc) return json({ code: "XX000", message: "falha simulada do banco" }, 500);
    switch (rpc) {
      case "acquire_itau_pix_runner": return json(!options.busy);
      case "itau_pix_maintain": return json({ expired: 0, renewed: 0 });
      case "itau_pix_claim": return json(rpcs.filter((name) => name === rpc).length === 1 ? options.claimed ?? [] : []);
      case "itau_pix_record": return json(null);
      case "itau_pix_release": return json(null);
      case "release_itau_pix_runner": return json(null);
      case "itau_pix_checkpoint":
        return json(JSON.parse(body).p_polled_until ? null : new Date(Date.now() - 60_000).toISOString());
      default: throw new Error(`RPC inesperada: ${rpc}`);
    }
  };
  try {
    // Como o job: POST com {} e o segredo da rotina.
    const response = await handler(new Request("https://function.example.test/itau-pix", {
      method: "POST", headers: { Authorization: `Bearer ${env.ITAU_PIX_CRON_SECRET}` }, body: "{}",
    }));
    return { status: response.status, body: await response.json(), rpcs, sentry, logs };
  } finally {
    globalThis.fetch = originalFetch;
    Deno.createHttpClient = originalHttpClient;
    console.error = originalConsoleError;
    names.forEach((name, index) => previous[index] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[index]!));
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type LogLine = { function?: string; step?: string; error?: string; detail?: { code?: string } };

// Cada falha vira uma linha JSON com a etapa.
function loggedLines(logs: unknown[][]): LogLine[] {
  return logs.map((args) => {
    assert(args.length === 1 && typeof args[0] === "string", `Log fora do formato estruturado: ${Deno.inspect(args)}`);
    const line = JSON.parse(args[0]) as LogLine;
    assert(line.function === "itau-pix" && typeof line.error === "string", `Log sem função ou erro: ${args[0]}`);
    return line;
  });
}

const loggedSteps = (logs: unknown[][]) => loggedLines(logs).map((line) => line.step);

function assertSentryEvent(sentry: string[], status: string) {
  assert(sentry.length === 1, `Esperado um evento no Sentry, vieram ${sentry.length}`);
  assert(sentry[0].includes('"function_name":"itau-pix"'), "Evento do Sentry sem a função");
  assert(sentry[0].includes(`"status":"${status}"`), `Evento do Sentry sem o status ${status}`);
  for (const secret of Object.values(env)) assert(!sentry[0].includes(secret), "Evento do Sentry com segredo ou configuração");
}

Deno.test("rodada sem falha responde 200 com o resumo zerado, sem log de erro nem Sentry", async () => {
  const run = await routineRun();
  // O resumo da fila conta as cobranças com resultado 'error' na chave `error`:
  // presente e zerada numa rodada boa, ela não é falha.
  assert(run.body.charges.error === 0 && run.body.charges.active === 0, `Resumo da fila inesperado: ${JSON.stringify(run.body)}`);
  assert(run.body.receipts.seen === 0 && typeof run.body.receipts.until === "string", "Consulta de recebimentos não rodou");
  assert(run.status === 200, `Rodada sem falha respondeu ${run.status}`);
  assert(run.logs.length === 0, `Log de erro numa rodada sem falha: ${Deno.inspect(run.logs)}`);
  assert(run.sentry.length === 0, "Evento no Sentry numa rodada sem falha");
});

Deno.test("outra execução com a vez: a fila pula e a rodada responde 200", async () => {
  const run = await routineRun({ busy: true });
  assert(run.status === 200, `Rodada com a vez ocupada respondeu ${run.status}`);
  assert(run.body.charges.skipped === "busy", "A fila deveria pular");
  assert(!run.rpcs.includes("itau_pix_claim"), "Reservou cobranças sem a vez");
});

Deno.test("falha na fila responde 500, segue para os recebimentos e registra no log e no Sentry", async () => {
  const run = await routineRun({ failRpc: "itau_pix_claim" });
  assert(run.status === 500, `Falha na fila respondeu ${run.status}`);
  assert(run.body.charges.error === "Falha ao reservar a fila Itaú.", `Erro da fila: ${JSON.stringify(run.body.charges)}`);
  assert(run.body.receipts.seen === 0, "A falha da fila não pode parar a consulta de recebimentos");
  assert(run.rpcs.includes("release_itau_pix_runner"), "A vez do runner não foi devolvida");
  assert(loggedSteps(run.logs).join() === "charges", `Etapas no log: ${loggedSteps(run.logs)}`);
  assertSentryEvent(run.sentry, "http_500");
});

Deno.test("falha na consulta de recebimentos responde 500 e registra no log e no Sentry", async () => {
  const run = await routineRun({ failRpc: "itau_pix_checkpoint" });
  assert(run.status === 500, `Falha na consulta respondeu ${run.status}`);
  assert(run.body.receipts.error === "Falha ao ler o checkpoint Itaú.", `Erro da consulta: ${JSON.stringify(run.body.receipts)}`);
  assert(run.body.charges.error === 0, "A fila desta rodada não falhou");
  assert(loggedSteps(run.logs).join() === "receipts", `Etapas no log: ${loggedSteps(run.logs)}`);
  assertSentryEvent(run.sentry, "http_500");
});

Deno.test("falha na manutenção dos prazos responde 500 e registra no log e no Sentry", async () => {
  const run = await routineRun({ failRpc: "itau_pix_maintain" });
  assert(run.status === 500, `Falha na manutenção respondeu ${run.status}`);
  assert(run.body.error === "Falha na manutenção dos prazos Itaú.", `Corpo: ${JSON.stringify(run.body)}`);
  assert(loggedSteps(run.logs).join() === "routine", `Etapas no log: ${loggedSteps(run.logs)}`);
  assertSentryEvent(run.sentry, "http_500");
});

Deno.test("devolução da vez que falha não muda o status, mas vai ao log com o código e ao Sentry", async () => {
  const run = await routineRun({ failRpc: "release_itau_pix_runner" });
  assert(run.status === 200, `Falha absorvida respondeu ${run.status}`);
  const lines = loggedLines(run.logs);
  assert(lines.length === 1 && lines[0].step === "runner_release" && lines[0].detail?.code === "XX000", `Log: ${JSON.stringify(lines)}`);
  assertSentryEvent(run.sentry, "runner_release");
});

Deno.test("429 no meio do bloco: a liberação das não chamadas que falha vai ao log e ao Sentry", async () => {
  const run = await routineRun({ failRpc: "itau_pix_release", claimed: [queued(1), queued(2)] });
  // Erro de uma cobrança fica gravado nela (itau_pix_record) e não é falha da rotina.
  assert(run.status === 200, `Rodada com cobrança limitada respondeu ${run.status}`);
  assert(run.body.charges.error === 1 && run.body.charges.throttled === true, `Resumo: ${JSON.stringify(run.body.charges)}`);
  assert(run.rpcs.filter((rpc) => rpc === "itau_pix_record").length === 1, "Só a cobrança chamada é registrada");
  assert(loggedSteps(run.logs).join() === "charges_release", `Etapas no log: ${loggedSteps(run.logs)}`);
  assertSentryEvent(run.sentry, "charges_release");
});
