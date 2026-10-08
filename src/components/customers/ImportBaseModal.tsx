import { TruncationNote } from '../shared/TruncationNote'
import { ImportIssuesPanel } from '../shared/ImportIssuesPanel'
import { ImportReadProgress } from '../shared/ImportReadProgress'
import { ImportFilePicker, ImportFootnote, ImportGuide, ImportNotice, ImportSection, ImportTemplateLinks } from '../shared/ImportParts'
import { plural } from '../shared/importPresentation'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { SummaryStrip } from '../ui/SummaryStrip'
import { formatCnpjCpf } from '../../lib/utils'
import { rowErrorsToImportIssues } from '../../services/importValidation'
import type { ParsedCustomerBase } from '../../services/customerBase'

const SAMPLE_SIZE = 15

export type CustomerBaseImportOutcome = {
  imported: number
  updated: number
  contactsCreated: number
  blsLinked: number
  errors: Array<{ cnpj_cpf: string; message: string }>
}

export function ImportBaseModal({
  open,
  baseFile,
  parsedBase,
  parsingBase,
  importingBase,
  readError,
  outcome,
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
  /** Resultado com pendências: o modal fica aberto para mostrar o que faltou. */
  outcome?: CustomerBaseImportOutcome | null
  onClose: () => void
  onFileSelect: (file: File | null) => void
  onImport: () => void
}) {
  const validRows = parsedBase?.rows.length ?? 0
  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  if (outcome) footnote = 'Base gravada em parte. Os clientes pendentes estão acima.'
  else if (parsingBase) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (parsedBase && validRows === 0) footnote = 'Nenhuma linha válida para importar.'
  else if (parsedBase) footnote = `${plural(validRows, 'cliente será gravado', 'clientes serão gravados')}. Nada foi gravado ainda.`

  return (
    <Modal open={open} onClose={onClose} title="Importar Base de Clientes">
      <div className="app-import">
        <ImportGuide
          required={<><strong>CNPJ</strong> e <strong>Razão Social</strong>.</>}
          optional="Nome Fantasia, Endereço, Cidade, UF, CEP e Email."
          details={
            <>
              <p>CNPJ já cadastrado é atualizado; a prévia mostra o que muda em cada um.</p>
              <p>O mesmo CNPJ em várias linhas com e-mails diferentes cria todos os e-mails como contatos do Cliente.</p>
              <p>Quando um manifesto trouxer o mesmo CNPJ, o B/L passa a usar o Cliente desta base como cadastro oficial.</p>
            </>
          }
          templates={<ImportTemplateLinks baseName="base-clientes-modelo" />}
        />

        <ImportFilePicker
          accept=".xlsx,.xls,.csv"
          files={baseFile ? [baseFile] : []}
          onFiles={(files) => onFileSelect(files[0] ?? null)}
          disabled={importingBase || Boolean(outcome)}
        />

        {parsingBase ? (
          <ImportReadProgress progress={{ completed: 0, total: 1, currentFile: baseFile?.name ?? null }} />
        ) : null}

        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler a base">
            <p>{readError}</p>
            <p>Confira o layout pelo modelo e escolha o arquivo de novo.</p>
          </ImportNotice>
        ) : null}

        {outcome ? <ImportBaseOutcome outcome={outcome} /> : parsedBase ? <ImportBasePreview parsedBase={parsedBase} /> : null}

        <div className="app-modal__actions">
          <ImportFootnote tone={outcome || (parsedBase && validRows === 0) ? 'warning' : 'default'}>{footnote}</ImportFootnote>
          {outcome ? (
            <Button onClick={onClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={importingBase} onClick={onClose}>
                Voltar
              </Button>
              <Button disabled={!validRows || parsingBase} loading={importingBase} loadingLabel="Importando…" onClick={onImport}>
                Importar base
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function ImportBaseOutcome({ outcome }: { outcome: CustomerBaseImportOutcome }) {
  return (
    <ImportNotice tone="warning" role="status" title={`${plural(outcome.errors.length, 'cliente ficou pendente', 'clientes ficaram pendentes')} para correção`}>
      <p>
        Gravados: {plural(outcome.imported, 'novo', 'novos')}, {plural(outcome.updated, 'atualizado', 'atualizados')},{' '}
        {plural(outcome.contactsCreated, 'contato', 'contatos')}
        {outcome.blsLinked ? ` e ${plural(outcome.blsLinked, 'B/L vinculado', 'B/Ls vinculados')}` : ''}.
      </p>
      <ul className="app-import-notice__list">
        {outcome.errors.map((error) => (
          <li key={error.cnpj_cpf}><strong>{formatCnpjCpf(error.cnpj_cpf)}:</strong> {error.message}</li>
        ))}
      </ul>
      <p>Corrija esses clientes na planilha e importe de novo; os já gravados não se duplicam.</p>
    </ImportNotice>
  )
}

function ImportBasePreview({ parsedBase }: { parsedBase: ParsedCustomerBase }) {
  const updates = parsedBase.rows.filter((row) => row.existingCustomerId && (row.changedFields?.length ?? 0) > 0).length
  const unchanged = parsedBase.rows.filter((row) => row.existingCustomerId && !(row.changedFields?.length ?? 0)).length
  const creates = parsedBase.rows.length - updates - unchanged
  const emails = parsedBase.rows.reduce((sum, row) => sum + row.emails.length, 0)
  const ignored = parsedBase.rowErrors.length
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
            { label: ignored === 1 ? 'linha ignorada' : 'linhas ignoradas', value: ignored, tone: ignored ? 'warning' : 'default' },
          ]}
        />
      }
    >
      <div className="app-table-scroll app-import-table">
        <table className="app-table app-table--compact min-w-[860px] text-left">
          <caption className="sr-only">Prévia dos clientes lidos</caption>
          <thead>
            <tr>
              <th scope="col">CNPJ</th>
              <th scope="col">Nome</th>
              <th scope="col">O que acontece</th>
              <th scope="col">E-mails</th>
              <th scope="col">Cidade/UF</th>
              <th scope="col">Endereço</th>
            </tr>
          </thead>
          <tbody>
            {parsedBase.rows.slice(0, SAMPLE_SIZE).map((row) => (
              <tr key={row.cnpj_cpf}>
                <td className="tabular-nums whitespace-nowrap">{formatCnpjCpf(row.cnpj_cpf)}</td>
                <td className="font-semibold text-[var(--app-text-strong)]">{row.name}</td>
                <td>
                  {row.existingCustomerId
                    ? row.changedFields?.length
                      ? <>Atualiza: <span className="app-import-tone--warning">{row.changedFields.join(', ')}</span></>
                      : <span className="app-import-tone--muted">Já cadastrado, sem alteração</span>
                    : 'Cria'}
                </td>
                <td>
                  <span className="app-table__truncate app-table__truncate--xl" title={row.emails.join('; ')}>
                    {row.emails.length ? row.emails.join('; ') : '—'}
                  </span>
                </td>
                <td>{row.city || row.state ? `${row.city ?? '—'}/${row.state ?? '—'}` : '—'}</td>
                <td>
                  <span className="app-table__truncate app-table__truncate--xl" title={row.address ?? undefined}>{row.address ?? '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TruncationNote shown={SAMPLE_SIZE} total={parsedBase.rows.length} noun="cliente" nounPlural="clientes" />

      <ImportIssuesPanel
        issues={rowErrorsToImportIssues(parsedBase.rowErrors)}
        filename="base-clientes-linhas-ignoradas.csv"
        title={`${plural(ignored, 'linha fica', 'linhas ficam')} de fora`}
        hint="As demais linhas podem ser importadas. Para incluir estas, corrija a planilha e escolha o arquivo de novo."
      />
    </ImportSection>
  )
}
