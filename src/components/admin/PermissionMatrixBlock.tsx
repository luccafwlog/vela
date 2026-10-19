import { Fragment, useState } from 'react'
import { Check, Circle } from 'lucide-react'
import { Block } from '../ui/Block'
import { SegmentedControl } from '../ui/SegmentedControl'
import { DEPARTMENT_LABELS } from '../../lib/departmentLabel'
import {
  DEPARTMENTS,
  PERMISSION_MATRIX,
  isSharedByAll,
  rowsByGroup,
  type PermissionCell,
} from '../../services/permissionMatrix'

type MatrixView = 'exclusivas' | 'todas'

const VIEW_OPTIONS = [
  { value: 'exclusivas', label: 'Só exclusivas' },
  { value: 'todas', label: 'Todas as ações' },
] as const

/**
 * "O que cada setor pode" (lote 5b, opção A): a matriz do catálogo único
 * `permissionMatrix.ts`, que a bateria por perfil confere no banco. "Só
 * exclusivas" esconde as linhas em que os cinco setores podem.
 */
export function PermissionMatrixBlock() {
  const [view, setView] = useState<MatrixView>('exclusivas')
  const rows = view === 'todas' ? PERMISSION_MATRIX : PERMISSION_MATRIX.filter((row) => !isSharedByAll(row))

  return (
    <Block
      title="O que cada setor pode"
      aside={<SegmentedControl label="Ações mostradas" options={VIEW_OPTIONS} value={view} onChange={setView} />}
      flush
    >
      <div className="app-table-scroll">
        <table className="app-table">
          <caption className="sr-only">O que cada setor pode fazer no sistema</caption>
          <thead>
            <tr>
              <th scope="col" className="app-table__text-head">Ação</th>
              {DEPARTMENTS.map((department) => (
                <th key={department} scope="col">{DEPARTMENT_LABELS[department]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsByGroup(rows).map(({ group, rows: groupRows }) => (
              <Fragment key={group.id}>
                <tr>
                  <td colSpan={DEPARTMENTS.length + 1} className="font-semibold">{group.label}</td>
                </tr>
                {groupRows.map((row) => (
                  <tr key={row.id}>
                    <td className="app-table__text app-table__text--wrap">{row.action}</td>
                    {DEPARTMENTS.map((department) => (
                      <td key={department}><MatrixCell value={row.can[department]} /></td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-xs text-[var(--app-muted)]">
        ✓ pode · ○ não pode. Todos os setores leem tudo; cada linha é uma ação que o sistema confere.
        Nenhum setor pode desativar o último Administrativo ativo, escrever em nome de outra pessoa nem
        alterar fatura, cálculo ou pagamento fora das ações do sistema.
      </p>
    </Block>
  )
}

function MatrixCell({ value }: { value: PermissionCell }) {
  if (typeof value === 'string') return <span>{value}</span>
  return value
    ? <Check size={16} role="img" aria-label="Pode" className="inline-block" />
    : <Circle size={12} role="img" aria-label="Não pode" className="inline-block text-[var(--app-muted)]" />
}
