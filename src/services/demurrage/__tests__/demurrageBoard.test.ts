import { describe, expect, it } from 'vitest'
import { divisionTotals, nextStep, type BoardBox, type BoardGroup } from '../demurrageBoard'

const box = (patch: Partial<BoardBox>): BoardBox => ({
  container_id: 1, bl_id: 'BL1', container_number: 'TGHU0000001', type: '40HC', rate_group: '40GP',
  discharge_date: '2026-09-01', return_date: null, total_days: 40, free_days: 21, free_source: 'tabela',
  last_free_day: '2026-09-22', days_p1: 19, rate_p1_usd: 60, days_p2: 0, rate_p2_usd: 80, usd: 1140,
  state: 'running', covered_by: null, covered_doc: null, ...patch,
})

const group = (patch: Partial<BoardGroup>): BoardGroup => ({
  anchor_bl_id: 'BL1', bl_ids: ['BL1'], voyage_id: 1, voyage_label: 'NAVIO / 001', customer_id: 1,
  customer_name: 'ACME', customer_cnpj: '00000000000191', division: 'travado', reason_code: 'sem_tarifa',
  reason: 'Tipo 45HC sem tarifa de Demurrage.', warning: null, no_rate_types: '45HC', usd: 0, boxes: [], ...patch,
})

describe('nextStep do "sem tarifa" (migration 526)', () => {
  it('tipo fora do cadastro: Cadastrar tipo, já preenchido', () => {
    expect(nextStep(group({ no_rate_kind: 'tipo_novo' }))).toMatchObject({ label: 'Cadastrar tipo', href: '/demurrage/taxas?tab=tipos&tipo=45HC' })
  })

  it('tipo desativado: Reativar tipo', () => {
    expect(nextStep(group({ no_rate_kind: 'tipo_inativo' }))).toMatchObject({ label: 'Reativar tipo', href: '/demurrage/taxas?tab=tipos&tipo=45HC' })
  })

  it('tipo cadastrado num grupo sem tarifa vigente: Cadastrar tarifa', () => {
    expect(nextStep(group({ no_rate_kind: 'tarifa', no_rate_types: '40FR' }))).toMatchObject({ label: 'Cadastrar tarifa', href: '/demurrage/taxas' })
  })
})

describe('contagens e Esperando', () => {
  it('a divisão conta só as caixas com sobreestadia, não as que ainda estão no free time', () => {
    const correndo = group({
      division: 'correndo', reason_code: null, usd: 1140,
      boxes: [box({}), box({ container_number: 'TGHU0000002', state: 'in_free_time', usd: null })],
    })
    expect(divisionTotals([correndo]).correndo).toEqual({ groups: 1, boxes: 1, usd: 1140 })
  })

  it('Esperando não cita a caixa dispensada ainda fora', () => {
    const waiting = group({
      division: 'esperando', reason_code: null,
      boxes: [
        box({ container_number: 'TGHU0000001', state: 'waived' }),
        box({ container_number: 'TGHU0000002', state: 'in_free_time', last_free_day: '2026-11-05' }),
        box({ container_number: 'TGHU0000003', return_date: '2026-10-20', state: 'returned_overstay' }),
      ],
    })
    expect(nextStep(waiting)).toEqual({ kind: 'wait', text: 'Aguarda TGHU0000002 até 05/11' })
  })
})
