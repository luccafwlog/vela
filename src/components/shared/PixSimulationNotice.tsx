const labels: Record<string, string> = {
  pending: 'Emissão ou atualização pendente.',
  active: 'Cobrança ativa no simulador.',
  expired: 'Cobrança expirada.',
  cancel_pending: 'Cancelamento aguardando confirmação.',
  cancelled: 'Cobrança cancelada.',
  paid: 'Pagamento simulado conciliado.',
  review: 'Recebimento precisa de análise.',
}

export function PixSimulationNotice({ state }: { state?: string | null }) {
  if (!state?.startsWith('simulation:')) return null
  return (
    <p role="status" data-testid="pix-simulation-notice" style={{ marginTop: 16 }}>
      <strong>Simulação Pix — sem transferência bancária.</strong>{' '}
      {labels[state.slice('simulation:'.length)] ?? 'Verifique o estado da cobrança.'}
    </p>
  )
}
