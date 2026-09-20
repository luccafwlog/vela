import { describe, expect, it } from 'vitest'
import { classifyDbError, extractErrorText, isRetriableDbError, userFacingErrorMessage } from '../errors'

describe('extractErrorText', () => {
  it('junta os campos de um erro do Supabase preservando o casing', () => {
    expect(extractErrorText(new Error('Falha GRAVE'))).toBe('Falha GRAVE')
    expect(extractErrorText('Erro X')).toBe('Erro X')
    expect(extractErrorText({ code: 'P0001', message: 'Conflito', details: 'D', hint: 'H' })).toBe(
      'P0001 Conflito D H',
    )
  })

  it('ignora campos vazios ao juntar', () => {
    expect(extractErrorText({ code: '42501', message: 'permission denied', details: null, hint: '' })).toBe(
      '42501 permission denied',
    )
  })

  it('retorna string vazia para entradas vazias/desconhecidas', () => {
    expect(extractErrorText(null)).toBe('')
    expect(extractErrorText(undefined)).toBe('')
    expect(extractErrorText(123)).toBe('')
  })
})

describe('classifyDbError', () => {
  it('extrai code/message de um Error nativo com code anexado', () => {
    expect(classifyDbError(Object.assign(new Error('raw limit'), { code: 'P0429' }))).toEqual({
      kind: 'limite',
      message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    })
  })

  it('extrai code/message de um objeto plano (erro do PostgREST)', () => {
    expect(classifyDbError({ code: 'PGRST301', message: 'JWT expired' })).toEqual({
      kind: 'sessao_expirada',
      message: 'Sua sessao expirou. Entre novamente para continuar.',
    })
  })

  it('trata string como mensagem sem code', () => {
    expect(classifyDbError('falha qualquer')).toEqual({ kind: 'desconhecido', message: 'falha qualquer' })
  })

  it('preserva a mensagem de negocio para codigos marcados como preserveMessage', () => {
    expect(classifyDbError({ code: '22023', message: 'Informe o motivo da disputa.' })).toEqual({
      kind: 'validacao',
      message: 'Informe o motivo da disputa.',
    })
    expect(classifyDbError({ code: 'P0002', message: 'Esta fatura ja possui uma disputa em aberto.' })).toEqual({
      kind: 'nao_encontrado',
      message: 'Esta fatura ja possui uma disputa em aberto.',
    })
  })

  it('NAO preserva a mensagem crua para codigos de constraint sem preserveMessage', () => {
    expect(classifyDbError({ code: '23503', message: 'update or delete on table "voyages" violates foreign key constraint "fk_x" on table "bls"' })).toEqual({
      kind: 'validacao',
      message: 'Registro referenciado nao existe ou ainda esta em uso.',
    })
  })

  it('usa a mensagem canonica de 42501 quando o texto cru expõe nome de tabela', () => {
    expect(classifyDbError({ code: '42501', message: 'permission denied for table customers' })).toEqual({
      kind: 'permissao',
      message: 'Sem permissao para esta acao. Solicite acesso administrativo.',
    })
  })

  it('preserva a mensagem de 42501 quando ela e um texto de negocio (RAISE customizado)', () => {
    expect(classifyDbError({ code: '42501', message: 'Usuario sem permissao ativa para importar bookings.' })).toEqual({
      kind: 'permissao',
      message: 'Usuario sem permissao ativa para importar bookings.',
    })
  })

  it('classifica mensagem generica de permission denied sem code conhecido', () => {
    expect(classifyDbError({ code: '', message: 'permission denied' })).toEqual({
      kind: 'permissao',
      message: 'Sem permissao para esta acao. Solicite acesso administrativo.',
    })
  })

  it('preserva a mensagem de negocio de um RAISE EXCEPTION com codigo 23514', () => {
    expect(classifyDbError({ code: '23514', message: 'Depot exige entrada e saida validas.' })).toEqual({
      kind: 'validacao',
      message: 'Depot exige entrada e saida validas.',
    })
  })

  it('usa a mensagem canonica de 23514 quando o texto cru expõe constraint do Postgres', () => {
    expect(classifyDbError({
      code: '23514',
      message: 'new row for relation "vazios_export_service_lines" violates check constraint "vazios_export_lines_percentual_check"',
    })).toEqual({
      kind: 'validacao',
      message: 'Dados fora das regras do cadastro.',
    })
  })

  it('cai no fallback desconhecido para code nao mapeado', () => {
    expect(classifyDbError({ code: '99999', message: 'erro nunca visto' })).toEqual({
      kind: 'desconhecido',
      message: 'erro nunca visto',
    })
    expect(classifyDbError({ code: '99999', message: '' })).toEqual({
      kind: 'desconhecido',
      message: 'Falha inesperada. Tente novamente.',
    })
  })

  it('retorna desconhecido para entradas vazias/sem forma de erro', () => {
    expect(classifyDbError(null)).toEqual({ kind: 'desconhecido', message: 'Falha inesperada. Tente novamente.' })
    expect(classifyDbError(123)).toEqual({ kind: 'desconhecido', message: 'Falha inesperada. Tente novamente.' })
  })
})

describe('isRetriableDbError', () => {
  it('nao repete erros de construcao de query do PostgREST', () => {
    // PGRST201: duas foreign keys ligam as mesmas tabelas e o embed nao nomeia
    // qual usar. Repetir devolve o mesmo 300 Multiple Choices.
    expect(isRetriableDbError({ code: 'PGRST201', message: 'Could not embed because more than one relationship was found' })).toBe(false)
    expect(isRetriableDbError({ code: 'PGRST116', message: 'JSON object requested, multiple rows returned' })).toBe(false)
  })

  it('nao repete negativa de RLS nem sessao expirada', () => {
    expect(isRetriableDbError({ code: '42501', message: 'permission denied for table invoices' })).toBe(false)
    expect(isRetriableDbError({ code: 'PGRST301', message: 'JWT expired' })).toBe(false)
  })

  it('continua repetindo falhas transitorias', () => {
    expect(isRetriableDbError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isRetriableDbError({ code: '40001', message: 'could not serialize access' })).toBe(true)
  })
})

describe('userFacingErrorMessage', () => {
  it('traduz erros conhecidos e nunca exibe mensagem técnica desconhecida', () => {
    expect(userFacingErrorMessage({ code: '23503', message: 'violates foreign key constraint fk_bls' })).toBe(
      'Registro referenciado nao existe ou ainda esta em uso.',
    )
    expect(userFacingErrorMessage(new Error('relation internal_table does not exist'), 'Não foi possível excluir.')).toBe(
      'Não foi possível excluir.',
    )
  })
})
