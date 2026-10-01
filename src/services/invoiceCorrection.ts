/** Preview in cents; the RPC repeats this calculation under a row lock. */
export function previewInvoiceCorrection(currentTotal: number, openBalance: number, correctedTotal: number) {
  const cents = (value: number) => Math.round(value * 100)
  if (![currentTotal, openBalance, correctedTotal].every(Number.isFinite) || correctedTotal < 0) return null
  const difference = cents(currentTotal) - cents(correctedTotal)
  if (difference <= 0) return null
  const offset = Math.min(difference, cents(openBalance))
  return { difference: difference / 100, offset: offset / 100, refund: (difference - offset) / 100,
    balance: (cents(openBalance) - offset) / 100 }
}
