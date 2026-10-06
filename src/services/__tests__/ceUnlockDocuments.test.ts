import { expect, it } from "vitest";
import { readCeMultipart, validateCePdf } from "../../../supabase/functions/_shared/ceUnlockFile";
it("aceita somente PDF real, não vazio e até 10 MiB", () => {
  expect(() =>
    validateCePdf(
      "x.pdf",
      "application/pdf",
      new TextEncoder().encode("%PDF-1.7\nbody"),
    ),
  ).not.toThrow();
  expect(() =>
    validateCePdf(
      "x.pdf",
      "application/pdf",
      new TextEncoder().encode("<html>fake</html>"),
    ),
  ).toThrow();
  expect(() =>
    validateCePdf(
      "x.html",
      "application/pdf",
      new TextEncoder().encode("%PDF-1.7"),
    ),
  ).toThrow();
  expect(() =>
    validateCePdf("x.pdf", "application/pdf", new Uint8Array(10485761)),
  ).toThrow();
});

it("limita multipart mesmo quando Content-Length não foi declarado", async () => {
 const req = new Request("http://localhost/upload", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=example" }, body: new Uint8Array(11 * 1024 * 1024) });
 expect(req.headers.get("Content-Length")).toBeNull();
 await expect(readCeMultipart(req)).rejects.toThrow("Arquivo acima do limite");
});
