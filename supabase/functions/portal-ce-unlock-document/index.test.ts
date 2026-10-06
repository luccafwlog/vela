// Exercises the actual handler/client boundary with a fake HTTP backend; no remote writes.
let handler: (req: Request) => Promise<Response>;
const serve = Deno.serve;
Deno.serve = ((callback: typeof handler) => { handler = callback; }) as typeof Deno.serve;
try {
  await import("./index.ts");
} finally {
  Deno.serve = serve;
}

async function uploadScenario(options: { invalid?: boolean; storeError?: boolean; finishError?: boolean; registered?: boolean }) {
  const originalFetch = globalThis.fetch;
  const variables = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = variables.map(name => Deno.env.get(name));
  Deno.env.set(variables[0], "https://ce-upload.example.test");
  Deno.env.set(variables[1], "test-anon");
  Deno.env.set(variables[2], "test-service");
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    calls.push(path);
    let value: unknown;
    let status = 200;
    if (path === "/auth/v1/user") value = { id: "00000000-0000-0000-0000-000000000001" };
    else if (path.endsWith("ce_unlock_prepare_upload")) value = { id: "document", storage_path: "customer/test.pdf" };
    else if (path.endsWith("ce_unlock_finish_upload")) {
      value = options.finishError ? { message: "Finish response failed", code: "P0001" } : { id: "document", status: "uploaded" };
      status = options.finishError ? 400 : 200;
    } else if (path.endsWith("ce_unlock_abort_upload")) value = options.registered ? null : "customer/test.pdf";
    else if (path.endsWith("ce_unlock_cleanup_record")) value = null;
    else if (path.endsWith("/customer/test.pdf")) {
      value = options.storeError ? { message: "Storage unavailable", error: "Storage unavailable" } : { Key: "customer/test.pdf" };
      status = options.storeError ? 500 : 200;
    } else if (path === "/storage/v1/object/ce-unlock-documents") value = [{ name: "customer/test.pdf" }];
    else throw new Error(`Unexpected backend call: ${path}`);
    return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  };
  try {
    const form = new FormData();
    form.set("context", JSON.stringify({ source: "request", type: "termo", request_id: "request" }));
    form.set("file", new File([options.invalid ? "not a PDF" : "%PDF-1.7\nbody"], "test.pdf", { type: "application/pdf" }));
    const response = await handler(new Request("https://function.example.test", {
      method: "POST", headers: { Authorization: "Bearer test-session" }, body: form,
    }));
    await response.text();
    return { status: response.status, calls };
  } finally {
    globalThis.fetch = originalFetch;
    variables.forEach((name, index) => previous[index] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[index]!));
  }
}
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("invalid PDF does not reserve a document", async () => {
  const result = await uploadScenario({ invalid: true });
  assert(result.status === 422, `Unexpected status: ${result.status}`);
  assert(!result.calls.some(path => path.endsWith("ce_unlock_prepare_upload")), "Invalid file reserved a document");
});
Deno.test("storage failure claims and cleans only the pending upload", async () => {
  const result = await uploadScenario({ storeError: true });
  assert(result.status === 500, `Unexpected status: ${result.status}`);
  assert(result.calls.some(path => path.endsWith("ce_unlock_abort_upload")), "Storage failure left an active reservation");
  assert(result.calls.some(path => path.endsWith("ce_unlock_cleanup_record")), "Claimed reservation was not cleaned");
});
Deno.test("lost finish acknowledgement preserves an already registered PDF", async () => {
  const result = await uploadScenario({ finishError: true, registered: true });
  assert(result.status === 422, `Unexpected status: ${result.status}`);
  assert(result.calls.some(path => path.endsWith("ce_unlock_abort_upload")), "Pending state was not checked");
  assert(!result.calls.includes("/storage/v1/object/ce-unlock-documents"), "Registered PDF was deleted");
});
Deno.test("successful upload finalizes without compensation", async () => {
  const result = await uploadScenario({});
  assert(result.status === 201, `Unexpected status: ${result.status}`);
  assert(result.calls.some(path => path.endsWith("ce_unlock_finish_upload")), "Upload was not finalized");
  assert(!result.calls.some(path => path.endsWith("ce_unlock_abort_upload")), "Successful upload was aborted");
});
