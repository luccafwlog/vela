// Handler real do webhook de e-mail com assinatura Svix gerada pela própria
// biblioteca e o banco simulado por fetch falso (plano de correção dos
// e-mails, 5.4). O corpo segue o evento real de 14/10/2026 (portal_email_events
// id 99, "email.delivered" da MillionSend), com o endereço trocado.
import { Webhook } from "https://esm.sh/svix@1.99.1";

let handler: (req: Request) => Promise<Response>;
const serve = Deno.serve;
Deno.serve = ((callback: typeof handler) => { handler = callback; }) as typeof Deno.serve;
try {
  await import("./index.ts");
} finally {
  Deno.serve = serve;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Segredo de teste no formato da MillionSend/Resend (whsec_ + base64).
const SECRET = "whsec_" + btoa("segredo-de-teste-do-webhook-32by");
const REAL_EVENT = {
  type: "email.delivered",
  created_at: "2026-10-14T15:13:40.000Z",
  data: {
    email_id: "2df1c8e5-8a51-4af7-85e0-2d037a2055ce",
    from: "Portal Fwlog <no-reply@portalfwlog.com.br>",
    to: ["destinatario@exemplo.com.br"],
    subject: "Recuperação de senha",
    created_at: "2026-10-14T15:13:38.000Z",
  },
};

type Inserted = Record<string, unknown>;

async function scenario(options: { body?: string; secret?: string; ageSeconds?: number; existing?: { id: number; status: string } }) {
  const originalFetch = globalThis.fetch;
  const variables = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_WEBHOOK_SECRET"];
  const previous = variables.map((name) => Deno.env.get(name));
  Deno.env.set("SUPABASE_URL", "https://webhook.example.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service");
  Deno.env.set("RESEND_WEBHOOK_SECRET", SECRET);
  const inserted: Inserted[] = [];
  const paths: string[] = [];
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    paths.push(`${request.method} ${url.pathname}`);
    if (url.pathname !== "/rest/v1/portal_email_events") return new Response("{}", { status: 404 });
    if (request.method === "GET") {
      const rows = options.existing ? [options.existing] : [];
      const single = (request.headers.get("accept") ?? "").includes("vnd.pgrst.object");
      return new Response(JSON.stringify(single ? rows[0] ?? null : rows), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const row = await request.json() as Inserted;
    inserted.push(row);
    return new Response(JSON.stringify({ id: 99, status: "pending" }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  try {
    const body = options.body ?? JSON.stringify(REAL_EVENT);
    const id = "msg_e9c09aa9-763f-4576-929b-fd965c75f44d";
    const timestamp = new Date(Date.now() - (options.ageSeconds ?? 0) * 1000);
    const signature = new Webhook(options.secret ?? SECRET).sign(id, timestamp, body);
    const response = await handler(new Request("https://edge.example.test/portal-email-webhook", {
      method: "POST",
      headers: {
        "svix-id": id,
        "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
        "svix-signature": signature,
        "Content-Type": "application/json",
      },
      body,
    }));
    return { response, json: await response.json(), inserted, paths };
  } finally {
    globalThis.fetch = originalFetch;
    variables.forEach((name, index) => previous[index] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[index]!));
  }
}

Deno.test("evento real assinado é gravado com o envelope mínimo e responde 202", async () => {
  const { response, json, inserted } = await scenario({});
  assert(response.status === 202, `status ${response.status}`);
  assert(json.event_id === 99 && json.status === "pending", JSON.stringify(json));
  assert(inserted.length === 1, "expected one insert");
  const row = inserted[0];
  assert(row.provider_event_id === "msg_e9c09aa9-763f-4576-929b-fd965c75f44d", "provider_event_id from svix-id");
  assert(row.provider_message_id === REAL_EVENT.data.email_id, "provider_message_id from data.email_id");
  assert(row.event_type === "email.delivered" && row.status === "pending", JSON.stringify(row));
  // Só o envelope mínimo: sem remetente, assunto ou datas do provedor.
  assert(JSON.stringify(row.payload) === JSON.stringify({
    type: "email.delivered",
    data: { email_id: REAL_EVENT.data.email_id, to: ["destinatario@exemplo.com.br"] },
  }), JSON.stringify(row.payload));
});

Deno.test("assinatura com outro segredo é recusada sem tocar no banco", async () => {
  const { response, inserted, paths } = await scenario({ secret: "whsec_" + btoa("outro-segredo-qualquer-de-32-byt") });
  assert(response.status === 401, `status ${response.status}`);
  assert(inserted.length === 0 && paths.length === 0, paths.join(","));
});

Deno.test("assinatura com mais de 5 minutos é recusada", async () => {
  const { response, inserted } = await scenario({ ageSeconds: 10 * 60 });
  assert(response.status === 401, `status ${response.status}`);
  assert(inserted.length === 0, "nothing inserted");
});

Deno.test("corpo alterado depois de assinado é recusado", async () => {
  const signedBody = JSON.stringify(REAL_EVENT);
  const original = globalThis.fetch;
  // Assina um corpo e envia outro: troca o destinatário.
  const tampered = signedBody.replace("destinatario@", "outro@");
  const id = "msg_tampered";
  const timestamp = new Date();
  const signature = new Webhook(SECRET).sign(id, timestamp, signedBody);
  Deno.env.set("RESEND_WEBHOOK_SECRET", SECRET);
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}"); };
  try {
    const response = await handler(new Request("https://edge.example.test/portal-email-webhook", {
      method: "POST",
      headers: { "svix-id": id, "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)), "svix-signature": signature },
      body: tampered,
    }));
    assert(response.status === 401, `status ${response.status}`);
    assert(!called, "database must not be called");
  } finally {
    globalThis.fetch = original;
    Deno.env.delete("RESEND_WEBHOOK_SECRET");
  }
});

Deno.test("duplicata já processada responde 200 sem inserir", async () => {
  const { response, json, inserted } = await scenario({ existing: { id: 99, status: "processed" } });
  assert(response.status === 200, `status ${response.status}`);
  assert(json.duplicate === true && inserted.length === 0, JSON.stringify(json));
});

Deno.test("sem cabeçalhos do svix responde antes de ler o corpo", async () => {
  let pulled = false;
  const stream = () => new ReadableStream<Uint8Array>({ pull(controller) { pulled = true; controller.enqueue(new Uint8Array(1024)); controller.close(); } }, { highWaterMark: 0 });
  const withoutId = await handler(new Request("https://edge.example.test/portal-email-webhook", { method: "POST", body: stream(), duplex: "half" } as RequestInit));
  assert(withoutId.status === 400, `status ${withoutId.status}`);
  const withoutSignature = await handler(new Request("https://edge.example.test/portal-email-webhook", {
    method: "POST",
    headers: { "svix-id": "msg_sem_assinatura" },
    body: stream(),
    duplex: "half",
  } as RequestInit));
  assert(withoutSignature.status === 401, `status ${withoutSignature.status}`);
  assert(!pulled, "body must not be read");
});

Deno.test("corpo acima de 256 KiB responde 413 sem tocar no banco, mesmo sem Content-Length", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}"); };
  let pulled = 0;
  const chunk = new Uint8Array(64 * 1024).fill(32);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += chunk.length;
      controller.enqueue(chunk);
      if (pulled >= 4 * 1024 * 1024) controller.close();
    },
  });
  try {
    const response = await handler(new Request("https://edge.example.test/portal-email-webhook", {
      method: "POST",
      headers: { "svix-id": "msg_grande", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,qualquer" },
      body,
      duplex: "half",
    } as RequestInit));
    assert(response.status === 413, `status ${response.status}`);
    assert(pulled < 1024 * 1024, `pulled ${pulled}`);
    assert(!called, "database must not be called");
  } finally {
    globalThis.fetch = original;
  }
});
