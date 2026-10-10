import { asString, chunkArray, onlyDigits } from "../lib/utils";
import { matchHeaders, readSheet, type HeaderSpec } from "./importCore";
import { ceUnlockReconcile } from "./ceUnlockService";
import type { CeUnlockReconcileSummary } from "../types/ceUnlock";

// Leitura do "Exportar Tela" da ZPT (Desbloqueio de Frete :: Cargas) para conciliação.
// Só o essencial sai do navegador: CE, status, descrição, data e as colunas ainda em "Não".
// "Nome Usuario" (CPF e nome do operador da ZPT) e os horários dos checks são descartados aqui.
const SPEC: HeaderSpec<
  "ce" | "status" | "description" | "updated_at" | "financeiro" | "termo" | "procuracao" | "bl_entrega"
> = {
  aliases: {
    ce: ["ce", "ce mercante"],
    status: ["status"],
    description: ["descricao"],
    updated_at: ["data atualizacao"],
    financeiro: ["financeiro"],
    termo: ["term. devolucao", "term devolucao", "t. de devolucao", "termo de devolucao"],
    procuracao: ["procuracao"],
    bl_entrega: ["bl entrega", "bl de entrega"],
  },
  required: ["ce", "status"],
};
const REQUIREMENT_LABELS = {
  financeiro: "Financeiro",
  termo: "Term. Devolucao",
  procuracao: "Procuracao",
  bl_entrega: "BL Entrega",
} as const;

export type CeUnlockZptRow = {
  ce: string;
  status: string;
  description: string | null;
  updated_at: string | null;
  pending: string[];
};
export type ParsedCeUnlockZptFile = {
  rows: CeUnlockZptRow[];
  rowErrors: Array<{ row: number; message: string }>;
};

/** "06/10/2026 16:29:08" (horário de Brasília) -> ISO; null se o formato for desconhecido. */
export function parseZptDateTime(value: string): string | null {
  // Célula de data/hora do Excel chega do leitor comum como AAAA-MM-DD HH:MM.
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (iso) {
    const [, y, mo, d, h = "00", mi = "00", se = "00"] = iso;
    return `${y}-${mo}-${d}T${h}:${mi}:${se}-03:00`;
  }
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = m;
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`;
}

// A ZPT marca o requisito atendido com a data/hora ou "Sim - ..."; "Não" é o único pendente.
const isPending = (value: unknown) => /^n[aã]o$/i.test(asString(value));

export async function parseCeUnlockZptFile(buffer: ArrayBuffer): Promise<ParsedCeUnlockZptFile> {
  // values:'cru' mantém o CE de 15 dígitos como número exato; formatado viraria notação científica.
  const { headers, rows } = await readSheet(buffer);
  const { columnByField, missing } = matchHeaders(headers, SPEC);
  if (missing.length)
    throw new Error("Arquivo não reconhecido como exportação da ZPT: faltam as colunas CE e Status.");
  const out: CeUnlockZptRow[] = [];
  const rowErrors: ParsedCeUnlockZptFile["rowErrors"] = [];
  for (const row of rows) {
    const get = (field: keyof typeof columnByField) =>
      columnByField[field] === undefined ? "" : row[columnByField[field]!];
    const ce = onlyDigits(asString(get("ce")));
    const status = asString(get("status"));
    if (!ce || !status) {
      rowErrors.push({ row: row.rowNumber, message: "Linha sem CE ou sem Status." });
      continue;
    }
    out.push({
      ce,
      status,
      description: asString(get("description")) || null,
      updated_at: parseZptDateTime(asString(get("updated_at"))),
      pending: (Object.keys(REQUIREMENT_LABELS) as Array<keyof typeof REQUIREMENT_LABELS>)
        .filter((field) => isPending(get(field)))
        .map((field) => REQUIREMENT_LABELS[field]),
    });
  }
  if (!out.length) throw new Error("Nenhuma linha válida no arquivo da ZPT.");
  return { rows: out, rowErrors };
}

const CHUNK = 5000;
/** Envia em lotes (limite de 20000 por chamada no banco) e soma os resumos. */
export async function reconcileCeUnlockZpt(rows: CeUnlockZptRow[]): Promise<CeUnlockReconcileSummary> {
  const total: CeUnlockReconcileSummary = { rows: 0, unlocked: 0, divergent: 0, stale: 0, ignored: 0, unknown_ce: 0 };
  for (const chunk of chunkArray(rows, CHUNK)) {
    const part = await ceUnlockReconcile(chunk);
    for (const key of Object.keys(total) as Array<keyof CeUnlockReconcileSummary>) total[key] += part[key];
  }
  return total;
}
