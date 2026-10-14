import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Fact, FactList } from '../ui/Block'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { formatDate } from '../../lib/utils'
import { isBreakbulkCargoMode, isContainerCargoMode } from '../../lib/cargoMode'
import type { BLContainer, BLListItem } from '../../types/database'

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
type ListContainer = NonNullable<BLListItem['bl_containers']>[number] &
  Partial<Pick<BLContainer, 'return_date' | 'demurrage_status'>>

export function BlRowDetail({ bl, colSpan }: { bl: BLListItem; colSpan: number }) {
  // A RPC devolve a linha inteira de bl_containers; o tipo da lista (protegido)
  // só declara parte dela.
  const containers = (bl.bl_containers ?? []) as ListContainer[]
  const items = bl.bl_breakbulk_items ?? []
  const showContainers = isContainerCargoMode(bl.cargo_mode)
  const showBreakbulk = isBreakbulkCargoMode(bl.cargo_mode)
  const openLink = (
    <Link className="app-btn app-btn--secondary app-btn--sm" to={`/bls/${bl.id}`}>
      Abrir na ficha do B/L
    </Link>
  )

  return (
    <tr id={`bl-detail-${bl.id}`} data-row-detail className="bg-[var(--app-surface-muted)]">
      <td colSpan={colSpan} className="app-bl-row-detail">
        <div className="grid gap-5">
          {showContainers ? (
            <section className="grid gap-2">
              <DetailHead title="Contêineres" summary={containers.length ? containerSummary(containers) : null} action={openLink} />
              {containers.length ? (
                <DetailTable
                  headers={['Contêiner', 'Tipo', 'COC/SOC', 'Perfil', 'Lacre', 'Tara (kg)', 'Peso bruto (kg)', 'CBM (m³)', 'Descarga', 'Devolução', 'Demurrage']}
                  numeric={[5, 6, 7, 8, 9]}
                  rows={containers.map((container, index) => {
                    const soc = container.ownership === 'SOC'
                    return {
                      key: String(container.id ?? container.container_number ?? index),
                      cells: [
                        <span className="app-bl-code text-[var(--app-text-strong)]">{container.container_number ? <CopyValue value={container.container_number} label="número do contêiner" /> : <NoValue label="Sem número do contêiner" />}</span>,
                        container.type ?? <NoValue label="Sem tipo" />,
                        container.ownership === 'SOC' || container.ownership === 'COC' ? container.ownership : <NoValue label="Sem COC/SOC informado" />,
                        <ProfileCell isImo={Boolean(container.is_imo)} isOog={Boolean(container.is_oog)} imoClass={container.imo_class} unNumber={container.un_number} />,
                        <span className="app-bl-code">{container.seal_number ?? <NoValue label="Sem lacre" />}</span>,
                        formatOptionalNumber(container.tare_weight_kg, 'Sem tara'),
                        formatOptionalNumber(container.gross_weight_kg, 'Sem peso bruto'),
                        formatOptionalNumber(container.cbm, 'Sem CBM'),
                        container.discharge_date ? formatDate(container.discharge_date) : <NoValue label="Sem data de descarga" />,
                        container.return_date ? formatDate(container.return_date) : soc ? <StatusText tone="muted">Não se aplica</StatusText> : <NoValue label="Sem devolução" />,
                        <DemurrageCell container={container} />,
                      ],
                    }
                  })}
                />
              ) : (
                <EmptyLine>Nenhum contêiner vinculado a este B/L.</EmptyLine>
              )}
            </section>
          ) : null}

          {showBreakbulk ? (
            <section className="grid gap-2">
              <DetailHead title="Carga solta" summary={null} action={showContainers ? null : openLink} />
              {hasBreakbulkData(bl) ? (
                <FactList columns={4}>
                  <Fact label="Máquinas">{formatOptionalNumber(bl.bb_machine_qty, 'Sem quantidade de máquinas')}</Fact>
                  <Fact label="Packages" detail={bl.bb_packages_total != null && Number(bl.bb_packages_total) !== Number(bl.bb_packages_qty) ? `${formatOptionalText(bl.bb_packages_total)} no total` : null}>
                    {formatOptionalNumber(bl.bb_packages_qty, 'Sem packages')}
                  </Fact>
                  <Fact label="Peso">{bl.bb_weight_ton == null ? <NoValue label="Sem peso" /> : `${formatOptionalText(bl.bb_weight_ton)} t`}</Fact>
                  <Fact label="CBM">{bl.bb_cbm == null ? <NoValue label="Sem CBM" /> : `${formatOptionalText(bl.bb_cbm)} m³`}</Fact>
                </FactList>
              ) : null}
              {items.length ? (
                <DetailTable
                  headers={['Descrição', 'Packages', 'Unidade', 'Peso (kg)', 'CBM (m³)', 'Marcas']}
                  numeric={[1, 3, 4]}
                  text={[0, 5]}
                  rows={items.map((item, index) => ({
                    key: String(item.id ?? `${item.item_description}-${index}`),
                    cells: [
                      <span className="font-medium text-[var(--app-text-strong)]" title={item.item_description || undefined}>{item.item_description || <NoValue label="Sem descrição" />}</span>,
                      formatOptionalNumber(item.package_qty, 'Sem packages'),
                      item.package_unit ?? <NoValue label="Sem unidade" />,
                      formatOptionalNumber(item.gross_weight_kg, 'Sem peso'),
                      formatOptionalNumber(item.cbm, 'Sem CBM'),
                      item.marks ?? <NoValue label="Sem marcas" />,
                    ],
                  }))}
                />
              ) : null}
              {!hasBreakbulkData(bl) && !items.length ? (
                <EmptyLine>Nenhum dado de carga solta informado no B/L: sem máquinas, packages, peso ou CBM, e sem itens.</EmptyLine>
              ) : null}
            </section>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

function DetailHead({ title, summary, action }: { title: string; summary: string | null; action: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h3 className="app-bl-section-title">{title}</h3>
      {summary ? <span className="app-facts__detail">{summary}</span> : null}
      {action ? <span className="ml-auto">{action}</span> : null}
    </div>
  )
}

/** "2 contêineres · 2 COC · 48.500 kg · 112,5 m³ · 1 de 2 devolvido". */
function containerSummary(containers: ListContainer[]) {
  const soc = containers.filter((container) => container.ownership === 'SOC').length
  const coc = containers.length - soc
  const weight = containers.reduce((sum, container) => sum + Number(container.gross_weight_kg ?? 0), 0)
  const cbm = containers.reduce((sum, container) => sum + Number(container.cbm ?? 0), 0)
  const returned = containers.filter((container) => container.ownership !== 'SOC' && container.return_date).length
  const parts = [
    `${containers.length} ${containers.length === 1 ? 'contêiner' : 'contêineres'}`,
    [coc ? `${coc} COC` : '', soc ? `${soc} SOC` : ''].filter(Boolean).join(' · '),
    weight ? `${weight.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg` : '',
    cbm ? `${cbm.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 3 })} m³` : '',
    coc ? `${returned} de ${coc} ${returned === 1 ? 'devolvido' : 'devolvidos'}` : '',
  ]
  return parts.filter(Boolean).join(' · ')
}

function DemurrageCell({ container }: { container: ListContainer }) {
  if (container.ownership === 'SOC') return <StatusText tone="muted">Não se aplica (SOC)</StatusText>
  // Sem descarga o banco grava "no free time" por padrão (migration 197).
  if (!container.discharge_date) return <NoValue label="Sem descarga" />
  if (container.demurrage_status === 'returned') return <StatusText tone="muted">Devolvido</StatusText>
  if (container.demurrage_status === 'overdue') return <StatusText tone="warning">Em atraso</StatusText>
  return <StatusText>No free time</StatusText>
}

function hasBreakbulkData(bl: BLListItem) {
  return [bl.bb_machine_qty, bl.bb_packages_qty, bl.bb_packages_total, bl.bb_weight_ton, bl.bb_cbm].some((value) => value != null)
}

function formatOptionalText(value: number | string) {
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

function ProfileCell({ isImo, isOog, imoClass, unNumber }: { isImo: boolean; isOog: boolean; imoClass?: string | null; unNumber?: string | null }) {
  if (!isImo && !isOog) return <span className="text-[var(--app-muted)]">Padrão</span>
  const imo = isImo ? [`IMO${imoClass ? ` ${imoClass}` : ''}`, unNumber ? `ONU ${unNumber}` : ''].filter(Boolean).join(' · ') : ''
  return <span className="whitespace-nowrap">{[imo, isOog ? 'OOG' : ''].filter(Boolean).join(' · ')}</span>
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
