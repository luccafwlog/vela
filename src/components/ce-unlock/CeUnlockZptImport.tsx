import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Fact, FactList } from "../ui/Block";
import { NoValue } from "../ui/NoValue";
import { SummaryStrip } from "../ui/SummaryStrip";
import { ImportIssuesPanel } from "../shared/ImportIssuesPanel";
import {
  ImportFileBlock,
  ImportFilePicker,
  ImportFootnote,
  ImportGuide,
  ImportNotice,
  ImportSection,
  ImportSteps,
  ImportTemplateLinks,
} from "../shared/ImportParts";
import { TruncationNote } from "../shared/TruncationNote";
import { plural } from "../shared/importPresentation";
import { assertUploadFile } from "../../lib/fileGuard";
import { userFacingErrorMessage } from "../../lib/errors";
import { afterCeUnlockChanged } from "../../services/cacheEffects";
import {
  parseCeUnlockZptFile,
  reconcileCeUnlockZpt,
  type ParsedCeUnlockZptFile,
} from "../../services/ceUnlockZptReconcile";
import type { ImportIssue } from "../../services/importValidation";
import type { CeUnlockReconcileSummary } from "../../types/ceUnlock";

const SAMPLE_SIZE = 25;

/**
 * Concilia o "Exportar Tela" da ZPT com o que o Vela exportou. Resultado só
 * para o desk. Molde do lote 6a: Arquivo → Prévia → Resultado; qualquer CE
 * ilegível (ou Data Atualização ilegível) recusa o arquivo inteiro e linhas sem CE ou sem situação são
 * ignoradas com a contagem à vista (D3). A conciliação é uma gravação só.
 */
export function CeUnlockZptImport({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedCeUnlockZptFile | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState("");
  const [summary, setSummary] = useState<CeUnlockReconcileSummary | null>(null);

  async function chooseFile(chosen: File) {
    setFile(chosen);
    setParsed(null);
    setReadError("");
    setWriteError("");
    setSummary(null);
    setReading(true);
    try {
      assertUploadFile(chosen, [".xls", ".xlsx", ".csv"]);
      setParsed(await parseCeUnlockZptFile(await chosen.arrayBuffer()));
    } catch (e) {
      setReadError(e instanceof Error ? e.message : "Não foi possível ler o arquivo da ZPT.");
    } finally {
      setReading(false);
    }
  }

  async function run() {
    if (!parsed || parsed.rowErrors.length || parsed.fileError || !parsed.rows.length) return;
    setWriteError("");
    setBusy(true);
    try {
      setSummary(await reconcileCeUnlockZpt(parsed.rows));
      await afterCeUnlockChanged(client);
    } catch (e) {
      setWriteError(userFacingErrorMessage(e, "Falha ao conciliar o arquivo da ZPT."));
    } finally {
      setBusy(false);
    }
  }

  const issues: ImportIssue[] = (parsed?.rowErrors ?? []).map((error) => ({
    row: error.row,
    field: error.field,
    code: "invalid_group",
    severity: "error",
    message: error.message,
  }));
  const count = parsed?.rows.length ?? 0;
  const skipped = parsed?.skippedRows.length ?? 0;
  const fileError = parsed?.fileError ?? null;
  const hasErrors = issues.length > 0 || Boolean(fileError);
  const step = summary ? "resultado" : parsed || readError ? "previa" : "arquivo";

  let footnote = "Nada é gravado antes de você conferir a prévia e confirmar. Nada é enviado ao Cliente.";
  let tone: "default" | "warning" | "success" = "default";
  if (summary) {
    footnote = "Conciliação gravada.";
    tone = "success";
  } else if (reading) footnote = "Lendo o arquivo. Nada foi gravado.";
  else if (hasErrors) {
    footnote = "Com erro no arquivo, nada é conciliado. Corrija e escolha o arquivo de novo.";
    tone = "warning";
  } else if (count) footnote = "Prévia pronta. Nada foi gravado ainda.";

  return (
    <div className="app-import">
      <ImportSteps current={step} />

      <ImportFileBlock templates={<ImportTemplateLinks baseName="zpt-exportar-tela-exemplo" extensions={["xlsx"]} />}>
        <ImportGuide
          required={<><strong>CE</strong> e <strong>Status</strong>.</>}
          optional="Descrição, Data Atualização, Financeiro, Term. Devolução, Procuração e BL Entrega."
          details={(
            <>
              <p>Na ZPT, use <strong>Exportar Tela</strong> e envie o arquivo como veio (.xls, .xlsx ou .csv). Só a situação de cada CE é lida; os dados do operador da ZPT são descartados.</p>
              <p>Linhas sem CE ou sem situação são ignoradas. CE que não tem 15 dígitos ou Data Atualização ilegível impede a conciliação do arquivo inteiro.</p>
            </>
          )}
        />
        <ImportFilePicker
          accept=".xls,.xlsx,.csv"
          label="Arquivo da ZPT"
          files={file ? [file] : []}
          onFiles={([chosen]) => void chooseFile(chosen)}
          disabled={busy || reading}
        />
      </ImportFileBlock>

      {readError ? (
        <ImportNotice tone="danger" role="alert" title="Não foi possível ler o arquivo">
          <p>{readError}</p>
          <p>Confira se é o "Exportar Tela" da ZPT e escolha o arquivo de novo.</p>
        </ImportNotice>
      ) : null}

      {parsed && !summary ? (
        <ImportSection
          title="Prévia"
          aside={(
            <SummaryStrip
              label="O que a conciliação lê"
              items={[
                { label: count === 1 ? "CE" : "CEs", value: count },
                { label: skipped === 1 ? "linha sem CE ou situação ignorada" : "linhas sem CE ou situação ignoradas", value: skipped, tone: skipped ? "warning" : "default" },
                { label: issues.length === 1 ? "linha com erro" : "linhas com erro", value: issues.length, tone: issues.length ? "danger" : "default" },
              ]}
            />
          )}
        >
          {fileError ? (
            <ImportNotice tone="danger" role="alert" title="O arquivo impede a conciliação">
              <p>{fileError}</p>
            </ImportNotice>
          ) : null}
          {skipped ? (
            <ImportNotice tone="info" role="status" title={`${plural(skipped, "linha sem CE ou sem situação ignorada", "linhas sem CE ou sem situação ignoradas")}`}>
              <p>Linha {parsed.skippedRows.slice(0, 20).join(", ")}{skipped > 20 ? ` e mais ${skipped - 20}` : ""}. Elas não têm o que conciliar.</p>
            </ImportNotice>
          ) : null}
          {count ? (
            <>
              <div className="app-table-scroll app-import-table">
                <table className="app-table app-table--compact w-full">
                  <caption className="sr-only">CEs lidos do arquivo da ZPT</caption>
                  <thead>
                    <tr>
                      <th scope="col">CE</th>
                      <th scope="col">Situação na ZPT</th>
                      <th scope="col" className="app-table__text-head">Pendente na ZPT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, SAMPLE_SIZE).map((row, index) => (
                      <tr key={`${row.ce}-${index}`}>
                        <td className="app-import-code">{row.ce}</td>
                        <td>{row.status}</td>
                        <td className="app-table__text">{row.pending.length ? row.pending.join(", ") : <NoValue label="Nada pendente" />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TruncationNote shown={Math.min(SAMPLE_SIZE, count)} total={count} noun="CE" nounPlural="CEs" />
            </>
          ) : null}
          <p className="app-panel__meta">
            B/Ls desbloqueados na ZPT ficam como conferidos; B/Ls exportados e ainda bloqueados ficam como divergentes. Uma nova conciliação atualiza o resultado.
          </p>
        </ImportSection>
      ) : null}

      {!summary ? <ImportIssuesPanel issues={issues} filename="zpt-erros.csv" /> : null}

      {writeError ? (
        <ImportNotice tone="danger" role="alert" title="A conciliação não foi concluída">
          <p>Nada foi gravado: {writeError}</p>
          <p>A prévia continua aqui; confirme de novo quando o problema for resolvido.</p>
        </ImportNotice>
      ) : null}

      {summary ? (
        <ImportSection title="Resultado" aside={plural(summary.rows, "linha conciliada", "linhas conciliadas")}>
          <div role="status" aria-label="Resultado da conciliação">
            <FactList columns={2}>
              <Fact label="Desbloqueados">{summary.unlocked.toLocaleString("pt-BR")}</Fact>
              <Fact label="Divergentes">{summary.divergent.toLocaleString("pt-BR")}</Fact>
              <Fact label="ZPT ainda sem atualização">{summary.stale.toLocaleString("pt-BR")}</Fact>
              <Fact label="Bloqueados não exportados">{summary.ignored.toLocaleString("pt-BR")}</Fact>
              <Fact label="CE desconhecido">{summary.unknown_ce.toLocaleString("pt-BR")}</Fact>
            </FactList>
          </div>
        </ImportSection>
      ) : null}

      <div className="app-modal__actions">
        <ImportFootnote tone={tone}>{footnote}</ImportFootnote>
        {summary ? (
          <Button onClick={onClose}>Concluir</Button>
        ) : (
          <>
            <Button variant="secondary" disabled={busy} onClick={onClose}>Voltar</Button>
            <Button
              disabled={!count || hasErrors || reading}
              loading={busy}
              loadingLabel="Conciliando…"
              onClick={() => void run()}
            >
              {count ? `Conciliar ${plural(count, "CE", "CEs")}` : "Conciliar CEs"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
