import { describe, expect, it } from 'vitest'
import { isImportContext, readRecordedReason } from '../auditReasons'

// Diagnóstico de 2026-11-06 (docs/archive/audits/administracao-2026-11-06.md):
// os textos abaixo são os que o banco e a tela gravam de fato em produção.
describe('motivo gravado no histórico, lido para a tela', () => {
  it('mantém o motivo que a pessoa escreveu', () => {
    expect(readRecordedReason('  Regra do THD mínimo precisa ser aplicada no BL. ')).toEqual({ text: 'Regra do THD mínimo precisa ser aplicada no BL.', origin: false })
  })

  it('some com o vazio e com o texto padrão salvo quando ninguém informou motivo', () => {
    for (const placeholder of [null, '', '   ', 'Revisao manual', 'Revisão manual', 'Atualizacao manual de ETD por POL', 'Atualizacao manual de linked por POD', 'Remocao de POD do planejamento', 'Atualizacao de dados da viagem', 'Lancamento manual de other charge']) {
      expect(readRecordedReason(placeholder)).toBeNull()
    }
  })

  it('o rastro da importação é origem, com ou sem acento; com o motivo da pessoa junto, é motivo', () => {
    expect(readRecordedReason('Importação de B/L · Viagem GREEN SEPETIBA 8')).toEqual({ text: 'Importação de B/L · Viagem GREEN SEPETIBA 8', origin: true })
    expect(readRecordedReason('Importacao de frete do BL: alteracao aplicada')?.origin).toBe(true)
    expect(isImportContext('Importação de CE Mercante · Viagem X · Motivo: CE corrigido')).toBe(false)
    expect(readRecordedReason('Importação de CE Mercante · Viagem X · Motivo: CE corrigido')?.origin).toBe(false)
  })

  it('traduz o texto técnico que o banco grava e o marca como origem', () => {
    const cases: Array<[string, string]> = [
      ['Gate canonico aplicado apos importacao', 'B/L enviado para a Revisão depois da importação'],
      ['Gate canonico reaplicado apos e-mail importado', 'B/L de volta à Revisão depois do e-mail importado'],
      ['Onboarding transacional de cliente pela revisão manual.', 'Cliente cadastrado na Revisão'],
      ['Marcado como pronto para faturar no modulo de Taxas Locais', 'Marcado como pronto para faturar em Taxas Locais'],
      ['Emissao de invoice por B/L', 'Fatura emitida pelo B/L'],
      ['Reprocesso automático das faturas retidas (portal_activation) pela conta de sistema', 'Faturas retidas emitidas: o Cliente ativou o Portal'],
      ['Reprocesso automático das faturas retidas (recovery_email) pela conta de sistema', 'Faturas retidas emitidas: o Cliente confirmou o e-mail de recuperação'],
      ['Reprocesso automático das faturas retidas (fonte_nova) pela conta de sistema', 'Faturas retidas emitidas'],
      ['Baixa via ledger (manual)', 'Baixa manual'],
      ['Baixa via ledger (itau_pix)', 'Baixa automática do Pix Itaú'],
      ['Baplie: marcas físicas aplicadas a todos os B/Ls ativos do container (conjunto atômico)', 'Baplie: marcas físicas aplicadas a todos os B/Ls ativos do container'],
      ['Saída confirmada em Chegadas e Saídas; a data do B/L a substitui se for diferente (ADR 0095)', 'Saída confirmada em Chegadas e Saídas; a data do B/L a substitui se for diferente'],
      ['NCM declarado no documento reimportado', 'NCM declarado no documento reimportado'],
    ]
    for (const [raw, text] of cases) expect(readRecordedReason(raw)).toEqual({ text, origin: true })
  })

  it('não confunde o motivo da pessoa que cita o ADR de Saída com a referência técnica', () => {
    expect(readRecordedReason('Assinatura atrasada (ADR de Saída da escala de Vitória)')).toEqual({ text: 'Assinatura atrasada (ADR de Saída da escala de Vitória)', origin: false })
  })
})
