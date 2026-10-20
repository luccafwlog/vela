import { asString, onlyDigits } from "../lib/utils";
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
  termo: "Term. Devolução",
  procuracao: "Procuração",
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
  /**
   * Linhas com conteúdo que não pode ser lido (CE que não tem 15 dígitos,
   * "Data Atualização" preenchida e ilegível): qualquer uma recusa o arquivo
   * inteiro (ADR 0091).
   */
  rowErrors: Array<{ row: number; field: "CE" | "Data Atualização"; message: string }>;
  /** Erro do arquivo como um todo (mais CEs que o limite): também recusa tudo. */
  fileError: string | null;
  /** Linhas sem CE ou sem situação: ignoradas, com a contagem na prévia (D3). */
  skippedRows: number[];
  /** Avisos do leitor comum (linhas e abas ocultas ignoradas, CSV Windows-1252), para mostrar antes de conciliar. */
  warnings: string[];
};

/** Limite de linhas por conciliação (o mesmo de `ce_unlock_reconcile`). */
export const ZPT_MAX_ROWS = 20000;

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
  const { headers, rows, warnings } = await readSheet(buffer);
  const { columnByField, missing } = matchHeaders(headers, SPEC);
  if (missing.length)
    throw new Error("Arquivo não reconhecido como exportação da ZPT: faltam as colunas CE e Status.");
  const out: CeUnlockZptRow[] = [];
  const rowErrors: ParsedCeUnlockZptFile["rowErrors"] = [];
  const skippedRows: number[] = [];
  for (const row of rows) {
    const get = (field: keyof typeof columnByField) =>
      columnByField[field] === undefined ? "" : row[columnByField[field]!];
    const rawCe = asString(get("ce"));
    const ce = onlyDigits(rawCe);
    const status = asString(get("status"));
    // D3: linha sem CE ou sem situação não tem o que conciliar; fica de fora,
    // contada na prévia.
    if (!rawCe || !status) {
      skippedRows.push(row.rowNumber);
      continue;
    }
    // CE preenchido que não é um CE Mercante (15 dígitos) é valor ilegível:
    // recusa o arquivo inteiro.
    if (ce.length !== 15) {
      rowErrors.push({ row: row.rowNumber, field: "CE", message: `CE "${rawCe}" ilegível: o CE Mercante tem 15 dígitos.` });
      continue;
    }
    // Data preenchida que não se lê é valor ilegível (ADR 0091); vazia fica vazia.
    const rawUpdatedAt = asString(get("updated_at"));
    const updatedAt = rawUpdatedAt ? parseZptDateTime(rawUpdatedAt) : null;
    if (rawUpdatedAt && !updatedAt) {
      rowErrors.push({
        row: row.rowNumber,
        field: "Data Atualização",
        message: `Data Atualização "${rawUpdatedAt}" ilegível: use DD/MM/AAAA HH:MM:SS.`,
      });
      continue;
    }
    out.push({
      ce,
      status,
      description: asString(get("description")) || null,
      updated_at: updatedAt,
      pending: (Object.keys(REQUIREMENT_LABELS) as Array<keyof typeof REQUIREMENT_LABELS>)
        .filter((field) => isPending(get(field)))
        .map((field) => REQUIREMENT_LABELS[field]),
    });
  }
  if (!out.length && !rowErrors.length) throw new Error("Nenhuma linha com CE e situação no arquivo da ZPT.");
  const fileError = out.length > ZPT_MAX_ROWS
    ? `O arquivo tem ${out.length.toLocaleString("pt-BR")} CEs; o limite é ${ZPT_MAX_ROWS.toLocaleString("pt-BR")} por conciliação. Divida o arquivo.`
    : null;
  return { rows: out, rowErrors, skippedRows, fileError, warnings };
}

/**
 * Concilia o arquivo inteiro numa chamada (`ce_unlock_reconcile` é uma
 * transação): se o banco recusa, nada é gravado. Antes ia em lotes de 5000,
 * cada um gravado por conta própria.
 */
export async function reconcileCeUnlockZpt(rows: CeUnlockZptRow[]): Promise<CeUnlockReconcileSummary> {
  if (rows.length > ZPT_MAX_ROWS) {
    throw new Error(`O limite é ${ZPT_MAX_ROWS.toLocaleString("pt-BR")} CEs por conciliação. Divida o arquivo.`);
  }
  return ceUnlockReconcile(rows);
}
