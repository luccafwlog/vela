// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BreakbulkReimportReview } from '../BreakbulkReimportReview'
import { NO_BREAKBULK_APPROVAL, type BreakbulkReimportCheck } from '../../../services/breakbulkImport'

afterEach(cleanup)

const check: BreakbulkReimportCheck = {
  existing: ['BB1'],
  otherVoyage: [],
  customerChanges: [{ blId: 'BB1', currentCustomer: 'CLIENTE A', fileCustomer: 'NOVO LTDA', fileCustomerMissing: true }],
  billedRouteChanges: [],
  codPodKept: [],
}

describe('BreakbulkReimportReview — textos da prévia', () => {
  it('diz que a Revisão é refeita e a nota escrita fica (BLR-D04)', () => {
    render(<BreakbulkReimportReview check={check} approval={NO_BREAKBULK_APPROVAL} onApprovalChange={() => undefined} />)
    expect(screen.getByText(/A Revisão é refeita pelas pendências do arquivo; a nota\s+escrita fica\./)).toBeTruthy()
    expect(screen.queryByText(/Revisão e observações ficam como estão/)).toBeNull()
  })

  it('só recusa a troca para consignatário não cadastrado com o B/L faturado (BLR-D12)', () => {
    render(<BreakbulkReimportReview check={check} approval={NO_BREAKBULK_APPROVAL} onApprovalChange={() => undefined} />)
    expect(screen.getByText(/Com o B\/L faturado \(fatura viva,\s+situação faturado ou pago, ou recebível com baixa\) a troca é recusada/)).toBeTruthy()
    expect(screen.queryByText(/Com fatura ou recebível/)).toBeNull()
  })
})
