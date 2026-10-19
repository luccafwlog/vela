import { useState } from 'react'
import { TruncationNote } from '../shared/TruncationNote'
import { ImportIssuesPanel } from '../shared/ImportIssuesPanel'
import { ImportReadProgress } from '../shared/ImportReadProgress'
import {
  ImportFileBlock,
  ImportFilePicker,
  ImportFootnote,
  ImportGuide,
  ImportNotice,
  ImportSection,
  ImportSteps,
  ImportTemplateLinks,
} from '../shared/ImportParts'
import { plural } from '../shared/importPresentation'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { NoValue } from '../ui/NoValue'
import { SummaryStrip } from '../ui/SummaryStrip'
import { formatCnpjCpf } from '../../lib/utils'
import { hasBlockingIssues, rowErrorsToImportIssues, type ImportIssue } from '../../services/importValidation'
import type { CustomerBaseRow, ParsedCustomerBase } from '../../services/customerBase'

const SAMPLE_SIZE = 15

/** Clientes que o banco recusou: nada da base foi gravado (migration 326). */
export type CustomerBaseRefusal = Array<{ cnpj_cpf: string; message: string }>

/**
 * Base de Clientes no molde do lote 6a: Arquivo → Prévia → Resultado. Qualquer
 * linha inválida bloqueia a base inteira na prévia; avisos (troca de razão
 * social, B/L rejeitado que a Base não vincula) pedem o aceite; a gravação é
 * uma chamada só e, se o banco recusa um Cliente, nada é gravado.
 */
export function ImportBaseModal({
  open,
  baseFile,
  parsedBase,
  parsingBase,
  importingBase,
  readError,
  writeError,
  refused,
  onClose,
  onFileSelect,
  onImport,
}: {
  open: boolean
  baseFile: File | null
  parsedBase: ParsedCustomerBase | null
  parsingBase: boolean
  importingBase: boolean
  /** Falha de leitura, mostrada junto do arquivo. */
  readError?: string | null
  /** Falha ao gravar: a prévia continua aberta para tentar de novo. */
  writeError?: string | null
  /** Clientes recusados pelo banco: nada foi gravado. */
  refused?: CustomerBaseRefusal | null
  onClose: () => void
  onFileSelect: (file: File | null) => void
  /** `confirmNameChange`: o aceite dos avisos cobre a troca de razão social. */
  onImport: (confirmNameChange: boolean) => void
}) {
  const [acceptedFor, setAcceptedFor] = useState<ParsedCustomerBase | null>(null)
  const accepted = Boolean(parsedBase) && acceptedFor === parsedBase

  const rows = parsedBase?.rows.length ?? 0
  const issues = parsedBase ? customerBaseIssues(parsedBase) : []
  const hasErrors = hasBlockingIssues(issues)
  const hasWarnings = issues.some((issue) => issue.severity === 'warning')
  const canImport = rows > 0 && !hasErrors && (!hasWarnings || accepted) && !parsingBase && !refused

  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  let tone: 'default' | 'warning' = 'default'
  if (refused) { footnote = 'Nada foi gravado. Corrija a planilha e escolha o arquivo de novo.'; tone = 'warning' }
  else if (parsingBase) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (hasErrors) { footnote = 'Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.'; tone = 'warning' }
  else if (parsedBase && rows === 0) { footnote = 'Nenhum Cliente para importar.'; tone = 'warning' }
  else if (hasWarnings && !accepted) { footnote = 'Confira os avisos e confirme o aceite para importar.'; tone = 'warning' }
  else if (parsedBase) footnote = 'Prévia pronta. Nada foi gravado ainda.'

  const step = refused ? 'resultado' : parsedBase || readError ? 'previa' : 'arquivo'

  return (
    <Modal open={open} onClose={onClose} title="Importar base de Clientes">
      <div className="app-import">
        <ImportSteps current={step} />

        <ImportFileBlock templates={<ImportTemplateLinks baseName="base-clientes-modelo" />}>
          <ImportGuide
            required={<><strong>CNPJ</strong>, <strong>Razão Social</strong> e <strong>E-mail</strong>.</>}
            optional="Nome Fantasia, Endereço, Cidade, UF e CEP."
            details={
              <>
                <p>CNPJ já cadastrado é atualizado; a prévia mostra o que muda em cada um.</p>
                <p>O mesmo CNPJ em várias linhas com e-mails diferentes cria todos os e-mails como contatos do Cliente.</p>
                <p>Quando um manifesto trouxer o mesmo CNPJ, o B/L passa a usar o Cliente desta base como cadastro oficial.</p>
                <p>Linha sem CNPJ válido, sem Razão Social ou sem e-mail impede a importação da base inteira.</p>
              </>
            }
          />
          <ImportFilePicker
            accept=".xlsx,.xls,.csv"
            files={baseFile ? [baseFile] : []}
            onFiles={(files) => onFileSelect(files[0] ?? null)}
            disabled={importingBase}
          />
        </ImportFileBlock>

        {parsingBase ? (
          <ImportReadProgress progress={{ completed: 0, total: 1, currentFile: baseFile?.name ?? null }} />
        ) : null}

        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler a base">
            <p>{readError}</p>
            <p>Confira o layout pelo modelo e escolha o arquivo de novo.</p>
          </ImportNotice>
        ) : null}

        {parsedBase && !refused ? <ImportBasePreview parsedBase={parsedBase} errors={issues.filter((issue) => issue.severity === 'error').length} /> : null}

        {!refused ? <ImportIssuesPanel issues={issues} filename="base-clientes-erros.csv" /> : null}

        {hasWarnings && !hasErrors && !refused ? (
          <label className="app-import-override">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAcceptedFor(event.target.checked ? parsedBase : null)}
            />
            <span>
              <span className="app-import-override__title">Conferi os avisos e quero importar o arquivo</span>
              <span className="app-import-override__hint">
                A razão social nova vale para as próximas faturas; faturas emitidas mantêm o documento congelado. B/L rejeitado na Revisão não é vinculado pela Base.
              </span>
            </span>
          </label>
        ) : null}

        {writeError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível gravar a base">
            <p>Nada foi gravado: {writeError}</p>
            <p>A prévia continua aqui; confira e tente importar de novo.</p>
          </ImportNotice>
        ) : null}

        {refused ? <ImportBaseRefused refused={refused} /> : null}

        <div className="app-modal__actions">
          <ImportFootnote tone={tone}>{footnote}</ImportFootnote>
          {refused ? (
            <Button onClick={onClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={importingBase} onClick={onClose}>
                Voltar
              </Button>
              <Button disabled={!canImport} loading={importingBase} loadingLabel="Importando…" onClick={() => onImport(accepted)}>
                {rows ? `Importar ${plural(rows, 'Cliente', 'Clientes')}` : 'Importar Clientes'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** Erros da leitura e avisos que pedem aceite (troca de razão social, B/L rejeitado). */
function customerBaseIssues(parsedBase: ParsedCustomerBase): ImportIssue[] {
  const warnings: ImportIssue[] = []
  for (const row of parsedBase.rows) {
    if (row.existingCustomerId && row.currentName) {
      warnings.push({
        row: row.row_number ?? 0,
        field: 'name',
        code: 'invalid_group',
        severity: 'warning',
        message: `${formatCnpjCpf(row.cnpj_cpf)}: razão social muda de "${row.currentName}" para "${row.name}".`,
      })
    }
    if (row.rejectedBlIds?.length) {
      warnings.push({
        row: row.row_number ?? 0,
        field: 'row',
        code: 'invalid_group',
        severity: 'warning',
        message: `${formatCnpjCpf(row.cnpj_cpf)}: ${plural(row.rejectedBlIds.length, 'B/L rejeitado', 'B/Ls rejeitados')} na Revisão (${row.rejectedBlIds.join(', ')}) não é vinculado pela Base.`,
      })
    }
  }
  return [...rowErrorsToImportIssues(parsedBase.rowErrors).map((issue) => ({ ...issue, severity: 'error' as const })), ...warnings]
}

function ImportBaseRefused({ refused }: { refused: CustomerBaseRefusal }) {
  return (
    <ImportSection title="Resultado" aside={plural(refused.length, 'Cliente recusado', 'Clientes recusados')}>
      <ImportNotice tone="danger" role="alert" title="Nada foi gravado: a base foi recusada">
        <p>Com um Cliente recusado, nenhum Cliente da base é gravado. Corrija as linhas abaixo e importe o arquivo de novo.</p>
        <ul className="app-import-notice__list">
          {refused.map((error) => (
            <li key={error.cnpj_cpf}><strong>{formatCnpjCpf(error.cnpj_cpf)}:</strong> {error.message}</li>
          ))}
        </ul>
      </ImportNotice>
    </ImportSection>
  )
}

function situationOf(row: CustomerBaseRow): { text: string; tone?: 'warning' | 'muted' } {
  if (!row.existingCustomerId) return { text: 'Cria' }
  if (row.currentName) return { text: 'Atualiza a razão social', tone: 'warning' }
  if (row.changedFields?.length) return { text: `Atualiza ${row.changedFields.join(', ')}`, tone: 'warning' }
  return { text: 'Sem alteração', tone: 'muted' }
}

function ImportBasePreview({ parsedBase, errors }: { parsedBase: ParsedCustomerBase; errors: number }) {
  const updates = parsedBase.rows.filter((row) => row.existingCustomerId && ((row.changedFields?.length ?? 0) > 0 || row.currentName)).length
  const unchanged = parsedBase.rows.filter((row) => row.existingCustomerId && !(row.changedFields?.length ?? 0) && !row.currentName).length
  const creates = parsedBase.rows.length - updates - unchanged
  const emails = parsedBase.rows.reduce((sum, row) => sum + row.emails.length, 0)
  const linked = parsedBase.rows.reduce((sum, row) => sum + (row.pendingBlIds?.length ?? 0), 0)
  return (
    <ImportSection
      title="Prévia"
      aside={
        <SummaryStrip
          label="O que a importação faz"
          items={[
            { label: creates === 1 ? 'novo' : 'novos', value: creates },
            { label: updates === 1 ? 'atualizado' : 'atualizados', value: updates },
            { label: 'sem alteração', value: unchanged },
            { label: emails === 1 ? 'e-mail' : 'e-mails', value: emails },
            { label: linked === 1 ? 'B/L vinculado' : 'B/Ls vinculados', value: linked },
            { label: errors === 1 ? 'linha com erro' : 'linhas com erro', value: errors, tone: errors ? 'danger' : 'default' },
          ]}
        />
      }
    >
      {parsedBase.rows.length ? (
        <>
          <div className="app-table-scroll app-import-table">
            <table className="app-table app-table--compact min-w-[760px]">
              <caption className="sr-only">Prévia dos Clientes lidos</caption>
              <thead>
                <tr>
                  <th scope="col">CNPJ</th>
                  <th scope="col" className="app-table__text-head">Razão Social</th>
                  <th scope="col" className="app-table__text-head">Situação</th>
                  <th scope="col" className="app-table__text-head">B/Ls</th>
                  <th scope="col" className="app-table__text-head">E-mails</th>
                  <th scope="col">Cidade/UF</th>
                </tr>
              </thead>
              <tbody>
                {parsedBase.rows.slice(0, SAMPLE_SIZE).map((row) => {
                  const situation = situationOf(row)
                  return (
                    <tr key={row.cnpj_cpf}>
                      <td className="tabular-nums whitespace-nowrap">{formatCnpjCpf(row.cnpj_cpf)}</td>
                      <td className="app-table__text" title={row.name}>{row.name}</td>
                      <td className={situation.tone ? `app-table__text app-import-tone--${situation.tone}` : 'app-table__text'}>{situation.text}</td>
                      <td className="app-table__text" title={row.pendingBlIds?.join(', ')}>
                        {row.pendingBlIds?.length ? row.pendingBlIds.join(', ') : <NoValue label="Sem B/L pendente" />}
                      </td>
                      <td>
                        <span className="app-table__truncate app-table__truncate--xl" title={row.emails.join('; ')}>
                          {row.emails.length ? row.emails.join('; ') : <NoValue label="Sem e-mail" />}
                        </span>
                      </td>
                      <td>{row.city || row.state ? <>{row.city ?? <NoValue label="Sem cidade" />}/{row.state ?? <NoValue label="Sem UF" />}</> : <NoValue label="Sem cidade/UF" />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <TruncationNote shown={SAMPLE_SIZE} total={parsedBase.rows.length} noun="Cliente" nounPlural="Clientes" />
        </>
      ) : null}
    </ImportSection>
  )
}
