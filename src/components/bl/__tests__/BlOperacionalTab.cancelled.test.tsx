// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../BlCeMercanteField', () => ({ BlCeMercanteField: () => null }))
vi.mock('../BlManifestoField', () => ({ BlManifestoField: () => null }))

import { BlOperacionalTab } from '../BlOperacionalTab'
import type { BlForm } from '../../../hooks/useBlEditForm'
import type { BLDetail } from '../../../types/database'

afterEach(cleanup)

const form = {
  shipper: 'SHIPPER', consignee: 'CONSIGNEE', notify_party: null, place_of_receipt: null,
  movement_from: null, movement_to: null, place_of_delivery: null, issue_place: null,
  bl_emission_date: null, bb_machine_qty: null, bb_packages_qty: null, bb_packages_total: null,
  bb_weight_ton: null, pol: 'CNSHA', pod: 'BRSSZ', cargo_description: null, total_weight_kg: null,
  total_cbm: null, bb_cbm: null, payment_type: null, free_time_override: null, notes: null, ncm_codes: '',
} as unknown as BlForm

function renderTab(cancelledAt: string | null) {
  return render(
    <BlOperacionalTab
      active
      bl={{ id: 'BL1', voyage_id: 1, ce_mercante: null, cancelled_at: cancelledAt } as unknown as BLDetail}
      form={form}
      changes={['shipper']}
      saving={false}
      justification=""
      cargoMode="container"
      isContainerMode
      hasContainers
      onFieldChange={() => undefined}
      onJustificationChange={() => undefined}
      onSubmit={() => undefined}
    />,
  )
}

describe('BlOperacionalTab com B/L cancelado (BLR-D07)', () => {
  it('trava o formulário, avisa e não oferece Salvar', () => {
    renderTab('2026-10-01T00:00:00Z')
    expect(screen.getByText('B/L cancelado: somente leitura. Reative para corrigir.')).toBeTruthy()
    expect((screen.getByDisplayValue('SHIPPER') as HTMLInputElement).closest('fieldset')?.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /Salvar alterações/ })).toBeNull()
  })

  it('B/L ativo segue editável', () => {
    renderTab(null)
    expect(screen.queryByText(/somente leitura/)).toBeNull()
    expect((screen.getByDisplayValue('SHIPPER') as HTMLInputElement).closest('fieldset')?.disabled).toBe(false)
    expect(screen.getByRole('button', { name: /Salvar alterações/ })).toBeTruthy()
  })
})
