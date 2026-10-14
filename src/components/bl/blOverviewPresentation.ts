export type BaplieStatus = {
  state: 'loading' | 'error' | 'not_imported' | 'reconciled'
  divergenceCount: number
}

/** Situação do Baplie em texto; cor só quando pede atenção. */
export function describeBaplie(status: BaplieStatus): { text: string; tone: 'default' | 'warning' | 'danger' | 'success' } {
  switch (status.state) {
    case 'loading':
      return { text: 'Verificando Baplie…', tone: 'default' }
    case 'error':
      return { text: 'Erro ao verificar Baplie', tone: 'danger' }
    case 'not_imported':
      return { text: 'Baplie não importado', tone: 'default' }
    case 'reconciled':
      return status.divergenceCount
        ? { text: `${status.divergenceCount} ${status.divergenceCount === 1 ? 'divergência' : 'divergências'} com o Baplie`, tone: 'warning' }
        : { text: 'Baplie sem divergências', tone: 'success' }
  }
}

type ReturnableContainer = { container_number: string; ownership?: string | null; return_date?: string | null }

/**
 * Dado principal do bloco Carga: quantos contêineres já voltaram. SOC é do
 * Cliente e não volta, então fica fora da conta; o mesmo número em mais de
 * uma linha (Part Lot) conta uma vez. Sem contêiner a devolver, não há dado
 * de devolução e a ficha mostra a contagem.
 */
export function describeReturns(containers: ReturnableContainer[]): { text: string; tone: 'default' | 'warning' } | null {
  const returnable = new Map<string, boolean>()
  for (const container of containers) {
    if (container.ownership === 'SOC') continue
    returnable.set(container.container_number, Boolean(returnable.get(container.container_number) || container.return_date))
  }
  if (!returnable.size) return null
  const returned = [...returnable.values()].filter(Boolean).length
  const total = returnable.size
  return {
    text: `${returned} de ${total} ${total === 1 ? 'devolvido' : 'devolvidos'}`,
    tone: returned < total ? 'warning' : 'default',
  }
}
