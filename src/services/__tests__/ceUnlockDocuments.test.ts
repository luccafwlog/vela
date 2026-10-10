import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CE_DOCX_MIME, readCeMultipart, validateCePdf, validateCeUpload } from "../../../supabase/functions/_shared/ceUnlockFile";
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

it("modelo do desk é DOCX real; termo, procuração e anuais continuam só PDF", () => {
  const docx = new Uint8Array(readFileSync("public/templates/memorando-liberacao-documentos-modelo.docx"));
  const pdf = new TextEncoder().encode("%PDF-1.7\nbody");
  expect(validateCeUpload("model", "Termo.docx", CE_DOCX_MIME, docx)).toBe(CE_DOCX_MIME);
  // Navegador sem tipo registrado para .docx envia vazio; o conteúdo decide.
  expect(validateCeUpload("model", "termo.docx", "", docx)).toBe(CE_DOCX_MIME);
  expect(() => validateCeUpload("model", "termo.pdf", "application/pdf", pdf)).toThrow("DOCX");
  // ZIP qualquer renomeado para .docx não passa.
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode("xl/workbook.xml")]);
  expect(() => validateCeUpload("model", "termo.docx", CE_DOCX_MIME, zip)).toThrow("DOCX");
  for (const source of ["request", "vip_annual"]) {
    expect(validateCeUpload(source, "termo.pdf", "application/pdf", pdf)).toBe("application/pdf");
    expect(() => validateCeUpload(source, "termo.docx", CE_DOCX_MIME, docx)).toThrow("PDF");
  }
});
