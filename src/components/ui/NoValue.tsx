/**
 * Ausência de dado (ADR 0081, regra 4): um "—" discreto, com o significado
 * para leitor de tela. Zero conhecido continua escrito ("Nenhuma", "R$ 0,00").
 */
export function NoValue({ label = 'Sem informação' }: { label?: string }) {
  return (
    <span className="app-no-value">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
