type QueryInvalidator = {
  invalidateQueries: (input: { queryKey: readonly unknown[] }) => Promise<unknown>
}

export async function invalidateBaplieDependentQueries(
  queryClient: QueryInvalidator,
  voyageId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['alerts'] }),
    queryClient.invalidateQueries({ queryKey: ['financial-alerts'] }),
    queryClient.invalidateQueries({ queryKey: ['invoice-corrections'] }),
    // Flags do Baplie em B/L faturado sem pagamento reemitem a fatura (126).
    queryClient.invalidateQueries({ queryKey: ['invoices'] }),
    queryClient.invalidateQueries({ queryKey: ['invoice-detail'] }),
    queryClient.invalidateQueries({ queryKey: ['billing-ledger'] }),
    queryClient.invalidateQueries({ queryKey: ['baplie-reconciliation', voyageId] }),
    queryClient.invalidateQueries({ queryKey: ['bls'] }),
    queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
    queryClient.invalidateQueries({ queryKey: ['voyages'] }),
    queryClient.invalidateQueries({ queryKey: ['voyage-timeline', voyageId] }),
    // P0-4: Baplie alimenta "Vazios descarregados" e a divergência de
    // existência de Carga descarregada no ADR; sem esta linha, reimportar ou
    // aplicar/manter atributo físico deixava a aba do ADR desatualizada.
    queryClient.invalidateQueries({ queryKey: ['agency-report'] }),
  ])
}
