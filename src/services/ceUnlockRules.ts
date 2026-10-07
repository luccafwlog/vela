import { sanitizeCellValue } from "../lib/spreadsheetSafe.ts";
export type AnnualDocument = {
  status: string;
  valid_from: string | null;
  valid_until: string | null;
  coverage_year: number | null;
};
export function annualDocumentValid(
  doc: AnnualDocument,
  now = new Date(),
): boolean {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return (
    doc.status === "approved" &&
    !!doc.valid_from &&
    doc.valid_until === `${doc.coverage_year}-12-31` &&
    doc.valid_from <= today &&
    doc.valid_until >= today
  );
}
type ZptItem = {
  bl_id: string;
  termo: boolean;
  procuracao: boolean;
  delivered: boolean;
  paid: boolean;
};
const yesNo = (value: boolean) => (value ? "Sim" : "Não");
// zpt-5-v2: mesmos cabeçalhos do "Exportar Tela" da ZPT, na mesma ordem.
// ponytail: o modelo de importação da aba "Planilha desbloqueio" ainda não foi fornecido; se a ZPT
// recusar esses cabeçalhos no primeiro upload real, ajustar só esta função e subir o layout para v3.
const zptRowsV2 = (item: ZptItem): Record<string, string> => ({
  BL: String(sanitizeCellValue(item.bl_id)),
  Financeiro: yesNo(item.paid),
  "Term. Devolucao": yesNo(item.termo),
  Procuracao: yesNo(item.procuracao),
  "BL Entrega": yesNo(item.delivered),
});
// zpt-5-v1: layout dos lotes gerados antes de 2026-10-07; mantido para baixar lotes antigos.
const zptRowsV1 = (item: ZptItem): Record<string, string> => ({
  BL: String(sanitizeCellValue(item.bl_id)),
  Termo: yesNo(item.termo),
  Procuração: yesNo(item.procuracao),
  "Entrega de BL": yesNo(item.delivered),
  "Pagamento das taxas": yesNo(item.paid),
});
export function zptRows(
  items: ZptItem[],
  layout = "zpt-5-v2",
): Record<string, string>[] {
  return items.map(layout === "zpt-5-v1" ? zptRowsV1 : zptRowsV2);
}
