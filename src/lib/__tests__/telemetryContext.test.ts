import { describe, expect, it } from 'vitest'
import {
  classifyErrorForTelemetry,
  describeMutation,
  describeQuery,
  describeRoute,
} from '../telemetryContext'

describe('telemetryContext', () => {
  describe('describeQuery', () => {
    it('mapeia chaves conhecidas do sistema para termos didáticos', () => {
      const pix = describeQuery(['pix-reconciliation-exceptions'])
      expect(pix).toEqual({
        modulo: 'Financeiro',
        tela: 'Conciliação PIX',
        tarefa: 'Listar pendências PIX',
        resumo: 'Falha ao executar "Listar pendências PIX" na tela "Conciliação PIX" (Financeiro).',
      })

      const invoices = describeQuery(['invoices', { status: 'open' }])
      expect(invoices.modulo).toBe('Faturamento')
      expect(invoices.tela).toBe('Faturas Locais')
      expect(invoices.tarefa).toBe('Listar faturas')

      const bls = describeQuery(['bls'])
      expect(bls.modulo).toBe('Operações')
      expect(bls.tela).toBe('Painel de BLs')

      const demurrage = describeQuery(['demurrage-invoices'])
      expect(demurrage.modulo).toBe('Demurrage')
      expect(demurrage.tela).toBe('Faturas Demurrage')
    })

    it('aplica fallback inteligente para chaves dinâmicas não mapeadas', () => {
      const custom = describeQuery(['relatorio-customizado', 123])
      expect(custom.modulo).toBe('Relatorio Customizado')
      expect(custom.tela).toBe('Relatorio Customizado')
      expect(custom.tarefa).toBe('Consultar relatorio customizado')
    })

    it('lida com entradas inválidas ou vazias', () => {
      const empty = describeQuery([])
      expect(empty.modulo).toBe('Geral')
      expect(empty.tela).toBe('Sistema')
      expect(empty.tarefa).toBe('Consulta de dados')
    })
  })

  describe('describeMutation', () => {
    it('mapeia chaves de mutação conhecidas', () => {
      const mutation = describeMutation(['demurrage-invoices'])
      expect(mutation.modulo).toBe('Demurrage')
      expect(mutation.tela).toBe('Faturas Demurrage')
      expect(mutation.tarefa).toBe('Salvar/Alterar: Listar faturas de demurrage')
    })

    it('extrai ação do meta quando presente', () => {
      const customAction = describeMutation(undefined, { action: 'Confirmar baixa PIX' })
      expect(customAction.tarefa).toBe('Confirmar baixa PIX')
    })
  })

  describe('describeRoute', () => {
    it('traduz rotas da aplicação para telas e módulos', () => {
      expect(describeRoute('/reconciliacao')).toEqual({
        modulo: 'Financeiro',
        tela: 'Conciliação PIX',
      })
      expect(describeRoute('/invoices/123')).toEqual({
        modulo: 'Faturamento',
        tela: 'Faturas Locais',
      })
      expect(describeRoute('/clientes/portal/inspecao')).toEqual({
        modulo: 'Portal do Cliente',
        tela: 'Portal de Autoatendimento',
      })
      expect(describeRoute('/painel')).toEqual({
        modulo: 'Painel',
        tela: 'Painel Principal',
      })
    })

    it('fornece fallback legível para rotas desconhecidas', () => {
      expect(describeRoute('/auditoria-fiscal/detalhes')).toEqual({
        modulo: 'Auditoria Fiscal',
        tela: 'Auditoria Fiscal',
      })
    })
  })

  describe('classifyErrorForTelemetry', () => {
    it('classifica erros de permissão do banco', () => {
      const err = { code: '42501', message: 'permission denied for table demurrage_invoices' }
      const res = classifyErrorForTelemetry(err)
      expect(res.categoria).toBe('Segurança / Permissão')
      expect(res.diagnostico).toBe('Sem permissao para esta acao. Solicite acesso administrativo.')
      expect(res.codigo).toBe('42501')
    })

    it('classifica erros de duplicidade do banco', () => {
      const err = { code: '23505', message: 'duplicate key value violates unique constraint' }
      const res = classifyErrorForTelemetry(err)
      expect(res.categoria).toBe('Banco de Dados / Conflito de Dados')
      expect(res.diagnostico).toBe('Este registro já existe.')
    })

    it('classifica falhas de conexão de rede', () => {
      const err = new TypeError('Failed to fetch')
      const res = classifyErrorForTelemetry(err)
      expect(res.categoria).toBe('Conectividade / Rede')
      expect(res.diagnostico).toContain('Falha de conexão com os servidores')
    })

    it('classifica exceções de script no navegador (TypeError genérico)', () => {
      const err = new TypeError("Cannot read properties of undefined (reading 'rest')")
      const res = classifyErrorForTelemetry(err)
      expect(res.categoria).toBe('Erro de Código / Runtime')
      expect(res.diagnostico).toContain("Cannot read properties of undefined (reading 'rest')")
    })
  })
})
