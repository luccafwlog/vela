import { describe, expect, it } from 'vitest'
import { buildFichaOverview, type OverviewInput } from '../fichaOverview'

const clean: OverviewInput = {
  customerId: 7,
  customerName: 'Atlântico & Cia',
  customerDocument: '12345678000195',
  portal: { account_situation: 'ativo', provisioning_decision: 'aprovado_para_provisionar', hasCriticalAlert: false, recovery_email: 'ti@atlantico.com.br', recoveryEmailStatus: 'ok', recoveryEmailSuppressed: false },
  recoveryEmailVisible: true,
  releaseUntil: false,
  blsInReview: 0,
  hasPrimaryEmail: true,
  pendingReconciliation: 0,
  demurrage: { overdue: 0, disputes: 0 },
  runningDemurrage: 0,
}

describe('buildFichaOverview', () => {
  it('Cliente em dia não tem pendência, nada carregando e nada falhou', () => {
    expect(buildFichaOverview(clean)).toEqual({ items: [], loading: [], failed: [] })
  })

  it('Portal não ativo trava a fatura e aponta Provisionamento e Liberação', () => {
    const { items } = buildFichaOverview({ ...clean, portal: { ...clean.portal as object, account_situation: 'sem_conta' } as OverviewInput['portal'] })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: 'portal', tone: 'warning', title: 'Portal não provisionado (sem conta)' })
    expect(items[0].detail).toMatch(/faturas ficam retidas/)
    expect(items[0].actions).toEqual([
      { label: 'Abrir no Provisionamento do Portal', to: '/clientes/portal?cliente=7' },
      { label: 'Liberação na aba Financeiro', tab: 'financeiro' },
    ])
  })

  it('com a Liberação vigente o Portal vira informação com a data de revisão', () => {
    const { items } = buildFichaOverview({
      ...clean,
      portal: { ...clean.portal as object, account_situation: 'convite_pendente' } as OverviewInput['portal'],
      releaseUntil: '2026-10-21',
    })
    expect(items[0]).toMatchObject({ tone: 'info', title: 'Portal não ativo (ativação pendente); faturamento liberado sem Portal até 21/10/2026' })
  })

  it('conta ativa com Email de Recuperação devolvido trava a fatura como o gate do banco', () => {
    const { items } = buildFichaOverview({ ...clean, portal: { ...clean.portal as object, recoveryEmailStatus: 'bounce_permanente' } as OverviewInput['portal'] })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: 'portal', tone: 'warning', title: 'Email de Recuperação com falha' })
    expect(items[0].detail).toMatch(/faturas ficam retidas/)
    expect(items[0].actions).toContainEqual({ label: 'Liberação na aba Financeiro', tab: 'financeiro' })
  })

  it('conta ativa sem Email de Recuperação não passa por "Nenhuma pendência"', () => {
    const { items } = buildFichaOverview({ ...clean, portal: { ...clean.portal as object, recovery_email: null, recoveryEmailStatus: null } as OverviewInput['portal'] })
    expect(items[0]).toMatchObject({ key: 'portal', title: 'Conta de Portal sem Email de Recuperação' })
  })

  it('perfil que não lê o Email de Recuperação não acusa trava de uma conta ativa', () => {
    const masked = { ...clean.portal as object, recovery_email: null, recoveryEmailStatus: null, recoveryEmailSuppressed: false } as OverviewInput['portal']
    expect(buildFichaOverview({ ...clean, portal: masked, recoveryEmailVisible: false }).items).toEqual([])
  })

  it('alerta crítico com a conta pronta não diz que a fatura está retida', () => {
    const { items } = buildFichaOverview({ ...clean, portal: { ...clean.portal as object, hasCriticalAlert: true } as OverviewInput['portal'] })
    expect(items[0]).toMatchObject({ key: 'portal', tone: 'danger', title: 'Alerta crítico aberto' })
    expect(items[0].detail).not.toMatch(/retidas/)
  })

  it('ordena o urgente primeiro e leva cada pendência ao lugar onde se resolve', () => {
    const { items } = buildFichaOverview({
      ...clean,
      blsInReview: 2,
      hasPrimaryEmail: false,
      demurrage: { overdue: 1, disputes: 0 },
      runningDemurrage: 3,
    })
    expect(items.map((item) => item.key)).toEqual(['vencidas', 'revisao', 'correndo', 'contato'])
    expect(items[1]).toMatchObject({ title: '2 B/Ls em revisão', actions: [{ label: 'Abrir na Revisão', to: '/revisao?busca=12345678000195' }] })
    expect(items[2].actions[0]).toEqual({ label: 'Abrir em Demurrage', to: '/demurrage?busca=Atl%C3%A2ntico%20%26%20Cia' })
    expect(items[3].detail).toMatch(/Não impede o faturamento/)
  })

  it('fonte que falhou ou carrega não vira "sem pendência"', () => {
    const result = buildFichaOverview({ ...clean, portal: null, releaseUntil: undefined, runningDemurrage: null })
    expect(result.failed).toEqual(['Portal', 'Demurrage correndo'])
    expect(result.loading).toEqual(['Liberação de faturamento'])
  })

  it('perfil sem leitura de Demurrage não conta como falha nem como pendência', () => {
    const result = buildFichaOverview({ ...clean, demurrage: false })
    expect(result).toEqual({ items: [], loading: [], failed: [] })
  })
})
