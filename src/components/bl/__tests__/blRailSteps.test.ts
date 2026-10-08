import { describe, expect, it } from 'vitest'
import { nextActionLinkLabel, railStagesToSteps } from '../blRailSteps'
import type { RailStage } from '../../../services/blRails'

const stage = (key: string, state: RailStage['state']): RailStage => ({ key, label: key, detail: key, state })

describe('trilhos do B/L no StepRail', () => {
  it('marca só a primeira etapa pendente como atual', () => {
    const steps = railStagesToSteps([stage('pol', 'done'), stage('pod', 'pending'), stage('discharge', 'pending')])
    expect(steps.map((step) => step.state)).toEqual(['done', 'current', 'pending'])
  })

  it('bloqueio continua bloqueio e impede outra etapa atual depois dele', () => {
    const steps = railStagesToSteps([stage('customer', 'blocked'), stage('charges', 'pending'), stage('ce', 'done')])
    expect(steps.map((step) => step.state)).toEqual(['blocked', 'pending', 'done'])
  })

  it('desvio por omissão usa o estado de desvio, sem virar concluído nem pendente', () => {
    expect(railStagesToSteps([stage('pol', 'done'), stage('pod', 'diverted')])[1].state).toBe('diverted')
  })

  it('o link da próxima ação diz o destino', () => {
    expect(nextActionLinkLabel('/revisao?bl=X')).toBe('Resolver na Revisão')
    expect(nextActionLinkLabel('/bls/X?tab=faturamento')).toBe('Ir para Faturamento')
    expect(nextActionLinkLabel('/bls/X?tab=detalhes')).toBe('Ir para Detalhes do B/L')
    expect(nextActionLinkLabel('/taxas-locais?invoice=1')).toBe('Abrir a fatura')
    expect(nextActionLinkLabel(undefined)).toBeNull()
  })
})
