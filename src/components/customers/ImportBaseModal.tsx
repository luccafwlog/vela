import type { ChangeEvent } from 'react'
import { Download } from 'lucide-react'
import { TruncationNote } from '../shared/TruncationNote'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { PreviewBox } from '../ui/PreviewBox'
import { formatCnpjCpf } from '../../lib/utils'
import type { ParsedCustomerBase } from '../../services/customerBase'

export function ImportBaseModal({
  open,
  baseFileName,
  parsedBase,
  parsingBase,
  importingBase,
  onClose,
  onFileChange,
  onImport,
}: {
  open: boolean
  baseFileName: string
  parsedBase: ParsedCustomerBase | null
  parsingBase: boolean
  importingBase: boolean
  onClose: () => void
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onImport: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Importar Base de Clientes">
      <div className="grid gap-5">
        <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4 text-sm text-[var(--app-muted)]">
          <div className="font-semibold text-white">Modelo padrao da base</div>
          <div className="mt-2">
            As colunas obrigatorias do arquivo sao <span className="font-semibold text-white">CNPJ</span> e{' '}
            <span className="font-semibold text-white">Razao Social</span>. As colunas opcionais sao Nome Fantasia,
            Endereco, Cidade, UF, CEP e Email.
          </div>
          <div className="mt-2 text-slate-400">
            Se o mesmo CNPJ aparecer em mais de uma linha com e-mails distintos, todos os e-mails serao criados
            como contatos do cliente.
          </div>
          <div className="mt-2 text-amber-200">
            CNPJs já cadastrados serão atualizados. O preview identifica cada atualização e os campos que mudarão.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
              href="/templates/base-clientes-modelo.xlsx"
              download="base-clientes-modelo.xlsx"
            >
              <Download size={16} />
              Baixar modelo .xlsx
            </a>
            <a
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
              href="/templates/base-clientes-modelo.csv"
              download="base-clientes-modelo.csv"
            >
              <Download size={16} />
              Baixar modelo .csv
            </a>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4 text-sm text-[var(--app-muted)]">
          Quando um manifesto trouxer o mesmo CNPJ, o B/L passa a usar o cliente desta base como cadastro
          oficial.
        </div>

        <Field label="Arquivo .xlsx, .xls ou .csv">
          <Input accept=".xlsx,.xls,.csv" type="file" onChange={onFileChange} />
        </Field>

        {baseFileName ? <div className="text-sm text-slate-400">Arquivo selecionado: {baseFileName}</div> : null}
        {parsingBase ? <div className="text-sm text-slate-400">Lendo base com SheetJS...</div> : null}

        {parsedBase ? <ImportBasePreview parsedBase={parsedBase} /> : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!parsedBase?.rows.length} loading={importingBase} onClick={onImport}>
            Importar base
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ImportBasePreview({ parsedBase }: { parsedBase: ParsedCustomerBase }) {
  const updates = parsedBase.rows.filter((row) => row.existingCustomerId && (row.changedFields?.length ?? 0) > 0).length
  const unchanged = parsedBase.rows.filter((row) => row.existingCustomerId && !(row.changedFields?.length ?? 0)).length
  const creates = parsedBase.rows.length - updates - unchanged
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <PreviewBox variant="surface" label="Clientes validos" value={parsedBase.rows.length} />
        <PreviewBox variant="surface" label="Linhas ignoradas" value={parsedBase.rowErrors.length} />
        <PreviewBox label="Emails detectados" value={parsedBase.rows.reduce((sum, row) => sum + row.emails.length, 0)} />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <PreviewBox variant="surface" label="Criar" value={creates} />
        <PreviewBox variant="surface" label="Atualizar cadastro" value={updates} />
        <PreviewBox variant="surface" label="Sem alteração cadastral" value={unchanged} />
      </div>

      {parsedBase.rowErrors.length ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          {parsedBase.rowErrors.length} linha(s) não puderam ser aproveitadas. As primeiras divergências estão listadas abaixo.
        </div>
      ) : null}

      <div className="app-table-scroll max-h-72 rounded-xl border border-[var(--app-border)]">
        <table className="app-table app-table--compact min-w-[760px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wider">
            <tr>
              <th scope="col" className="px-3 py-2">CNPJ</th>
              <th scope="col" className="px-3 py-2">Ação</th>
              <th scope="col" className="px-3 py-2">Nome</th>
              <th scope="col" className="px-3 py-2">Emails</th>
              <th scope="col" className="px-3 py-2">Cidade/UF</th>
              <th scope="col" className="px-3 py-2">Endereco</th>
            </tr>
          </thead>
          <tbody>
            {parsedBase.rows.slice(0, 15).map((row) => (
              <tr key={row.cnpj_cpf}>
                <td className="px-3 py-2">{formatCnpjCpf(row.cnpj_cpf)}</td>
                <td className="px-3 py-2">{row.existingCustomerId ? `Atualizar${row.changedFields?.length ? `: ${row.changedFields.join(', ')}` : ' (sem alteração cadastral)'}` : 'Criar'}</td>
                <td className="px-3 py-2 font-semibold text-white">{row.name}</td>
                <td className="px-3 py-2">
                  <span className="app-table__truncate app-table__truncate--xl" title={row.emails.join('; ')}>
                    {row.emails.length ? row.emails.join('; ') : '-'}
                  </span>
                </td>
                <td className="px-3 py-2">{row.city ?? '-'} / {row.state ?? '-'}</td>
                <td className="px-3 py-2">{row.address ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TruncationNote shown={15} total={parsedBase.rows.length} noun="cliente" nounPlural="clientes" />

      {parsedBase.rowErrors.length ? (
        <div className="grid gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4 text-sm text-[var(--app-muted)]">
          {parsedBase.rowErrors.slice(0, 8).map((rowError) => (
            <div key={`${rowError.row}-${rowError.message}`}>
              Linha {rowError.row}: {rowError.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
