import type { ReactNode } from 'react'
import { Badge } from '../ui/Badge'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
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
    <tr id={`bl-detail-${bl.id}`} data-row-detail className="bg-[var(--app-surface-muted)]">
      <td colSpan={colSpan} className="app-bl-row-detail">
        <div className="grid gap-5">
          {showContainers ? (
            <section className="grid gap-2">
              <h3 className="app-bl-section-title">Contêineres ({containers.length})</h3>
              {containers.length ? (
                <DetailTable
                  headers={['Número', 'Tipo', 'Lacre', 'Tara (kg)', 'Peso bruto (kg)', 'CBM (m³)', 'Perfil', 'Descarga']}
                  numeric={[3, 4, 5]}
                  rows={containers.map((container, index) => ({
                    key: String(container.id ?? container.container_number ?? index),
                    cells: [
                      <span className="app-bl-code text-[var(--app-text-strong)]">{container.container_number ? <CopyValue value={container.container_number} label="número do contêiner" /> : <NoValue label="Sem número do contêiner" />}</span>,
                      container.type ?? <NoValue label="Sem tipo" />,
                      container.seal_number ?? <NoValue label="Sem lacre" />,
                      formatOptionalNumber(container.tare_weight_kg, 'Sem tara'),
                      formatOptionalNumber(container.gross_weight_kg, 'Sem peso bruto'),
                      formatOptionalNumber(container.cbm, 'Sem CBM'),
                      <ProfileCell isImo={Boolean(container.is_imo)} isOog={Boolean(container.is_oog)} imoClass={container.imo_class} />,
                      container.discharge_date ? formatDate(container.discharge_date) : <NoValue label="Sem data de descarga" />,
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
              <h3 className="app-bl-section-title">Carga solta</h3>
              <DetailTable
                headers={['Máquinas', 'Packages', 'Total de packages', 'Peso (ton)', 'CBM (m³)']}
                numeric={[0, 1, 2, 3, 4]}
                rows={[{
                  key: 'resumo',
                  cells: [
                    formatOptionalNumber(bl.bb_machine_qty, 'Sem quantidade de máquinas'),
                    formatOptionalNumber(bl.bb_packages_qty, 'Sem packages'),
                    formatOptionalNumber(bl.bb_packages_total ?? bl.bb_packages_qty, 'Sem total de packages'),
                    formatOptionalNumber(bl.bb_weight_ton, 'Sem peso'),
                    formatOptionalNumber(bl.bb_cbm, 'Sem CBM'),
                  ],
                }]}
              />
              {items.length ? (
                <DetailTable
                  headers={['Descrição', 'Packages', 'Unidade', 'Peso (kg)', 'CBM (m³)', 'Marcas']}
                  numeric={[1, 3, 4]}
                  text={[0, 5]}
                  rows={items.map((item, index) => ({
                    key: String(item.id ?? `${item.item_description}-${index}`),
                    cells: [
                      <span className="font-medium text-[var(--app-text-strong)]">{item.item_description || <NoValue label="Sem descrição" />}</span>,
                      formatOptionalNumber(item.package_qty, 'Sem packages'),
                      item.package_unit ?? <NoValue label="Sem unidade" />,
                      formatOptionalNumber(item.gross_weight_kg, 'Sem peso'),
                      formatOptionalNumber(item.cbm, 'Sem CBM'),
                      item.marks ?? <NoValue label="Sem marcas" />,
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
  if (!isImo && !isOog) return <span className="text-[var(--app-muted)]">Padrão</span>
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
  numeric = [],
  text = [],
}: {
  headers: string[]
  rows: Array<{ key: string; cells: ReactNode[] }>
  /** Índices das colunas numéricas: algarismos tabulares (centralizadas pela tabela padrão). */
  numeric?: number[]
  /** Índices das colunas de texto longo (descrição, marcas): à esquerda, com reticências. */
  text?: number[]
}) {
  const cellClass = (index: number) => (numeric.includes(index) ? 'tabular-nums' : text.includes(index) ? 'app-table__text' : undefined)
  const headClass = (index: number) => (text.includes(index) ? 'app-table__text-head' : undefined)
  return (
    <>
      <table className="app-table app-table--compact app-table--dense hidden w-full sm:table">
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={header} scope="col" className={headClass(index)}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, index) => (
                <td key={headers[index]} className={cellClass(index)} title={text.includes(index) && typeof cell === 'string' ? cell : undefined}>{cell}</td>
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

function formatOptionalNumber(value: number | string | null | undefined, emptyLabel: string): ReactNode {
  if (value === null || value === undefined || value === '') return <NoValue label={emptyLabel} />
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : <NoValue label={emptyLabel} />
}
