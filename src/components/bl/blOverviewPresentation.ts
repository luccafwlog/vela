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
