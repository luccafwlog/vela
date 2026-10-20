import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderCustomerCommunicationTemplate } from '../customerCommunicationTemplates'

/**
 * O assunto dos avisos operacionais existe em três lugares: o renderizador
 * (única fonte usada no envio, compartilhada com o auto-runner), o seed do
 * squash e a tabela `customer_communication_templates`. A tabela é inerte
 * hoje; deixá-la divergir é o que a transforma num sósia enganoso — foi
 * exatamente assim que a migration 008 consertou a função errada. Este teste
 * prende os três ao mesmo texto.
 */
const ESPERADO = {
  aviso_chegada_noa: 'Notice of Arrival / Chegada Próxima',
  aviso_prontidao_nor: 'Notice of Readiness / Aviso de Chegada',
  aviso_atracacao_nob: 'Notice of Berthing / Aviso de Atracação',
} as const

const base = {
  customerId: 1,
  customerName: 'Cliente',
  vesselName: 'COSCO SHIPPING XING WANG',
  voyageNumber: '2401E',
  port: 'Santos',
  terminalName: 'Terminal 1',
  terminalId: 'terminal-1',
  terminalStateId: 'state-1',
  milestoneAt: '2026-09-01T12:00:00Z',
  bls: [{ id: 'BL-1', customerId: 1, terminalId: 'terminal-1', terminalStateId: 'state-1', terminalName: 'Terminal 1' }],
}

describe('assunto bilíngue dos avisos operacionais', () => {
  it('o renderizador usa o lado português renomeado, mantendo o termo de mercado em inglês', () => {
    for (const [kind, prefixo] of Object.entries(ESPERADO)) {
      const rendered = renderCustomerCommunicationTemplate(kind as keyof typeof ESPERADO, base)
      expect(rendered.subject.startsWith(`${prefixo} — `)).toBe(true)
    }
  })

  it('o seed do squash e a migration 046 repetem exatamente o mesmo assunto', () => {
    const squash = readFileSync('scripts/build-squash-migrations.mjs', 'utf8')
    const migration = readFileSync('supabase/migrations/046_renomeia_avisos_operacionais.sql', 'utf8')

    for (const prefixo of Object.values(ESPERADO)) {
      expect(squash).toContain(`${prefixo} — {{vessel_name}}`)
    }
    // O NOB não mudou de nome, então não tem UPDATE — os outros dois têm.
    expect(migration).toContain(`SET subject_template = 'Notice of Arrival / Chegada Próxima — {{vessel_name}}`)
    expect(migration).toContain(`SET subject_template = 'Notice of Readiness / Aviso de Chegada — {{vessel_name}}`)
    // Guardados pelo valor antigo: reexecutar a migration não reescreve um
    // assunto que alguém já tenha customizado no banco.
    expect(migration).toContain(`AND subject_template = 'Notice of Arrival / Aviso de Chegada — {{vessel_name}}`)
    expect(migration).toContain(`AND subject_template = 'Notice of Readiness / Prontidão de Descarga — {{vessel_name}}`)
  })

  it('o renderizador usa o corpo condizente com Aviso de Chegada', () => {
    const rendered = renderCustomerCommunicationTemplate('aviso_prontidao_nor', base)
    expect(rendered.html).toContain('Registramos a chegada do seu navio conforme abaixo.')
    expect(rendered.html).toContain('>Chegada registrada<')
    expect(rendered.text).toContain('Registramos a chegada do seu navio conforme abaixo.')
  })

  it('nenhum texto vivo ainda chama o NOR de Prontidão de Descarga', () => {
    const renderer = readFileSync('src/services/customerCommunicationTemplates.ts', 'utf8')
    const page = readFileSync('src/pages/ClientesComunicacao.tsx', 'utf8')
    const service = readFileSync('src/services/customerCommunications.ts', 'utf8')
    for (const arquivo of [renderer, page, service]) {
      expect(arquivo.toLowerCase()).not.toContain('prontidão de descarga')
    }
  })
})
