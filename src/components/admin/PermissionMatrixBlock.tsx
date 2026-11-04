import { Fragment, useId, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Circle } from 'lucide-react'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
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
 * exclusivas" esconde as linhas em que os cinco setores podem. Abre recolhido
 * (decisão do dono de 2026-11-04): **Mostrar** abre a matriz e **Recolher** a fecha.
 */
export function PermissionMatrixBlock() {
  const [view, setView] = useState<MatrixView>('exclusivas')
  const [open, setOpen] = useState(false)
  const contentId = useId()
  const rows = view === 'todas' ? PERMISSION_MATRIX : PERMISSION_MATRIX.filter((row) => !isSharedByAll(row))
  const toggle = (
    <Button type="button" variant="secondary" className="app-btn--sm" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen((current) => !current)}>
      {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
      {open ? 'Recolher' : 'Mostrar'}
    </Button>
  )

  return (
    <Block
      title="O que cada setor pode"
      aside={open ? <>
        <SegmentedControl label="Ações mostradas" options={VIEW_OPTIONS} value={view} onChange={setView} />
        {toggle}
      </> : toggle}
      flush={open}
    >
      {!open ? (
        <p id={contentId} className="m-0 text-sm text-[var(--app-muted)]">
          A tabela das ações que cada setor pode fazer no sistema. Clique em Mostrar para abrir.
        </p>
      ) : (
      <div id={contentId}>
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
                  <th scope="rowgroup" colSpan={DEPARTMENTS.length + 1} className="app-table__text-head font-semibold">{group.label}</th>
                </tr>
                {groupRows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" className="app-table__text app-table__text--wrap font-normal">{row.action}</th>
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
        A conta Dev (Administrativo · Dev) pode tudo o que qualquer setor pode. Nenhum setor pode desativar o último Administrativo ativo, escrever em nome de outra pessoa nem
        alterar fatura, cálculo ou pagamento fora das ações do sistema.
      </p>
      </div>
      )}
    </Block>
  )
}

function MatrixCell({ value }: { value: PermissionCell }) {
  if (typeof value === 'string') return <span>{value}</span>
  return value
    ? <Check size={16} role="img" aria-label="Pode" className="inline-block" />
    : <Circle size={12} role="img" aria-label="Não pode" className="inline-block text-[var(--app-muted)]" />
}
