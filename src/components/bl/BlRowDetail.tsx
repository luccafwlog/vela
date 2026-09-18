import { Badge } from '../ui/Badge'
import { formatDate } from '../../lib/utils'
import { isBreakbulkCargoMode, isContainerCargoMode } from '../../lib/cargoMode'
import type { BLListItem } from '../../types/database'

/**
 * Conteúdo da linha expandida de `/bls`.
 *
 * Não busca nada: a RPC `operational_list_bls` já projeta `bl_containers` e
 * `bl_breakbulk_items` inteiros por linha, então o accordion custa zero query.
 *
 * As duas seções são governadas pelos mesmos predicados do resto do sistema
 * (`isContainerCargoMode`/`isBreakbulkCargoMode`), e não por um terceiro ramo
 * para `misto`: um B/L misto satisfaz os dois e renderiza as duas seções.
 */
export function BlRowDetail({ bl, colSpan }: { bl: BLListItem; colSpan: number }) {
  const containers = bl.bl_containers ?? []
  const items = bl.bl_breakbulk_items ?? []
  const showContainers = isContainerCargoMode(bl.cargo_mode)
  const showBreakbulk = isBreakbulkCargoMode(bl.cargo_mode)

  return (
    <tr data-row-detail className="bg-[var(--app-surface-muted)]">
      <td colSpan={colSpan} className="px-4 py-4">
        <div className="grid gap-5">
          {showContainers ? (
            <section className="grid gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">
                Contêineres ({containers.length})
              </h3>
              {containers.length ? (
                <DetailTable
                  headers={['Número', 'Tipo', 'Lacre', 'Tara (kg)', 'Peso bruto (kg)', 'CBM', 'Perfil', 'Descarga']}
                  rows={containers.map((container) => ({
                    key: String(container.id),
                    cells: [
                      <span className="font-semibold text-[var(--app-text-strong)]">{container.container_number || '—'}</span>,
                      container.type ?? '—',
                      container.seal_number ?? '—',
                      formatOptionalNumber(container.tare_weight_kg),
                      formatOptionalNumber(container.gross_weight_kg),
                      formatOptionalNumber(container.cbm),
                      <ProfileCell isImo={Boolean(container.is_imo)} isOog={Boolean(container.is_oog)} imoClass={container.imo_class} />,
                      container.discharge_date ? formatDate(container.discharge_date) : '—',
                    ],
                  }))}
                />
              ) : (
                <EmptyLine>Nenhum contêiner vinculado a este B/L.</EmptyLine>
              )}
            </section>
          ) : null}

          {showBreakbulk ? (
            <section className="grid gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Carga solta</h3>
              <DetailTable
                headers={['Máquinas', 'Volumes', 'Total de volumes', 'Peso (ton)', 'CBM (m³)']}
                rows={[{
                  key: 'resumo',
                  cells: [
                    formatOptionalNumber(bl.bb_machine_qty),
                    formatOptionalNumber(bl.bb_packages_qty),
                    formatOptionalNumber(bl.bb_packages_total ?? bl.bb_packages_qty),
                    formatOptionalNumber(bl.bb_weight_ton),
                    formatOptionalNumber(bl.bb_cbm),
                  ],
                }]}
              />
              {items.length ? (
                <DetailTable
                  headers={['Descrição', 'Volumes', 'Unidade', 'Peso (kg)', 'CBM', 'Marcas']}
                  rows={items.map((item) => ({
                    key: String(item.id),
                    cells: [
                      <span className="font-semibold text-[var(--app-text-strong)]">{item.item_description || '—'}</span>,
                      formatOptionalNumber(item.package_qty),
                      item.package_unit ?? '—',
                      formatOptionalNumber(item.gross_weight_kg),
                      formatOptionalNumber(item.cbm),
                      item.marks ?? '—',
                    ],
                  }))}
                />
              ) : (
                <EmptyLine>Nenhum item individual vinculado a este B/L.</EmptyLine>
              )}
            </section>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

function ProfileCell({ isImo, isOog, imoClass }: { isImo: boolean; isOog: boolean; imoClass?: string | null }) {
  if (!isImo && !isOog) return <span className="text-[var(--app-muted)]">Standard</span>
  return (
    <span className="flex flex-wrap gap-1">
      {isImo ? <Badge tone="red">{imoClass ? `IMO ${imoClass}` : 'IMO'}</Badge> : null}
      {isOog ? <Badge tone="yellow">OOG</Badge> : null}
    </span>
  )
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[var(--app-muted)]">{children}</p>
}

/**
 * Em telas estreitas a sub-tabela vira lista de pares rótulo/valor: uma terceira
 * barra de rolagem horizontal aninhada dentro da tabela principal, que já rola,
 * é inutilizável no celular.
 */
function DetailTable({
  headers,
  rows,
}: {
  headers: string[]
  rows: Array<{ key: string; cells: React.ReactNode[] }>
}) {
  return (
    <>
      <table className="app-table app-table--compact app-table--dense hidden w-full text-left text-sm sm:table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className="px-2 py-1.5 text-xs uppercase text-[var(--app-muted)]">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, index) => (
                <td key={headers[index]} className="px-2 py-1.5">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid gap-3 sm:hidden">
        {rows.map((row) => (
          <dl key={row.key} className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-[var(--app-border)] p-3 text-sm">
            {row.cells.map((cell, index) => (
              <div key={headers[index]} className="contents">
                <dt className="text-xs text-[var(--app-muted)]">{headers[index]}</dt>
                <dd>{cell}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </>
  )
}

function formatOptionalNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—'
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '—'
}
