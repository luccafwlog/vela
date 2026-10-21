import { describe, expect, it } from 'vitest'
import {
  DatabaseError,
  assertNoError,
  classifyDbError,
  extractErrorText,
  atomicImportRefusalMessage,
  importErrorMessage,
  isRetriableDbError,
  toError,
  userFacingErrorMessage,
} from '../errors'

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

  it('usa a mensagem canonica de 42501 para negativa de RLS', () => {
    expect(classifyDbError({
      code: '42501',
      message: 'new row violates row-level security policy for table "invoices"',
    })).toEqual({
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

describe('recusas de negócio das importações (P000x)', () => {
  // Mensagens reais das RPCs de importação (migrations 176, 194, 213).
  it.each([
    ['P0005', 'O B/L ABC1 ja esta na Viagem V1 e o arquivo foi importado na Viagem V2. Nenhum B/L do lote foi gravado: confira a Viagem de destino ou corrija a Viagem do B/L pela ficha.'],
    ['P0006', 'O container MSCU1234565 do B/L ABC1 tem a Invoice de Demurrage DEM-1 e não sai por reimportação.'],
    ['P0008', 'O container MSCU1234565 esta no B/L A (Cliente 1) e no B/L B (Cliente 2): container FCL nao e dividido entre Clientes diferentes. Corrija o Cliente ou o container do arquivo.'],
    ['P0003', 'B/L ABC1 sem CE Mercante. Cadastre o CE antes de faturar.'],
    ['P0001', 'Razão social diferente da cadastrada (A → B): confirme a troca.'],
  ])('%s mostra a mensagem do banco, que já nomeia o B/L ou o container', (code, message) => {
    expect(userFacingErrorMessage({ code, message }, 'Falha ao importar.')).toBe(message)
  })

  it.each(['P0001', 'P0003', 'P0005', 'P0006', 'P0008'])('%s sem mensagem usa um texto fixo em português, não o fallback', (code) => {
    const message = userFacingErrorMessage({ code, message: '' }, 'Falha ao importar.')
    expect(message).not.toBe('Falha ao importar.')
    expect(message).not.toMatch(/P000|[a-z]+_[a-z]+/)
  })

  it('P0001 com texto interno (identificador, guarda de migration) não vaza', () => {
    for (const message of [
      'BL de item de carga solta precisa ter cargo_mode = carga_solta',
      'effect_kind não suportado: x.',
      'REVISAO_OBSOLETA: esperada 1, atual 2.',
      '007: pg_net/net.http_post ausente',
    ]) {
      expect(userFacingErrorMessage({ code: 'P0001', message })).toBe('O sistema recusou a operação por uma regra de negócio.')
    }
  })

  it('P0003 com tabela.coluna no texto cai no texto fixo', () => {
    expect(userFacingErrorMessage({ code: 'P0003', message: 'Viagem 3 nao pode ser excluida: ha dados vinculados em public.bls.voyage_id.' }))
      .toBe('Operação bloqueada por uma pendência do B/L ou da Viagem.')
  })
})

describe('23505 com o valor repetido', () => {
  it('nomeia o valor quando o banco o expõe em details, sem o nome da coluna', () => {
    expect(userFacingErrorMessage({
      code: '23505',
      message: 'duplicate key value violates unique constraint "bls_pkey"',
      details: 'Key (id)=(MEDU123) already exists.',
    })).toBe('Já existe um registro com o valor "MEDU123".')
  })

  it('lê details de um DatabaseError', () => {
    const error = toError({ code: '23505', message: 'duplicate key value violates unique constraint "x_key"', details: 'Key (lower(email))=(a@b.com) already exists.' })
    expect(userFacingErrorMessage(error)).toBe('Já existe um registro com o valor "a@b.com".')
  })

  it('sem details, mensagem fixa com acento', () => {
    expect(userFacingErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "x_key"' })).toBe('Este registro já existe.')
  })

  it('RAISE de negócio com 23505 continua com a mensagem do banco', () => {
    expect(userFacingErrorMessage({ code: '23505', message: 'Este CNPJ já está em outro Cliente.', details: 'Key (cnpj)=(1) already exists.' }))
      .toBe('Este CNPJ já está em outro Cliente.')
  })
})

describe('importErrorMessage', () => {
  it('trava (40P01/55P03/40001): outra importação da mesma Viagem, nada gravado', () => {
    for (const code of ['40P01', '55P03', '40001']) {
      expect(importErrorMessage({ code, message: 'deadlock detected' }))
        .toBe('Outra importação da mesma Viagem estava em andamento. Nada foi gravado: tente de novo.')
    }
  })

  it('57014 na importação não manda reduzir período', () => {
    const message = importErrorMessage({ code: '57014', message: 'canceling statement due to statement timeout' })
    expect(message).toBe('A importação demorou demais e foi cancelada. Nada foi gravado: tente de novo ou divida o arquivo em partes menores.')
    // Consulta continua com a orientação de período.
    expect(userFacingErrorMessage({ code: '57014', message: 'canceling statement' })).toBe('A consulta demorou demais. Reduza o período e tente novamente.')
  })

  it('chave repetida numa tabela de preparo aponta a linha repetida no arquivo', () => {
    expect(importErrorMessage({
      code: '23505',
      message: 'duplicate key value violates unique constraint "tmp_bl_freight_import_pkey"',
      details: 'Key (id)=(MEDU123) already exists.',
    })).toBe('O valor "MEDU123" aparece mais de uma vez no arquivo. Deixe uma linha só para ele e importe de novo.')
    expect(importErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "tmp_x_pkey"' }))
      .toBe('Há uma linha repetida no arquivo. Deixe uma linha só para cada registro e importe de novo.')
  })

  it('erro desconhecido não vaza inglês nem código', () => {
    expect(importErrorMessage({ code: 'XX000', message: 'internal error' })).toBe('Não foi possível importar o arquivo. Tente novamente.')
  })
})

describe('atomicImportRefusalMessage', () => {
  it('enquadra em "Nada foi gravado" sem código nem inglês', () => {
    expect(atomicImportRefusalMessage({ code: 'P0008', message: 'O container X esta no B/L A (C1) e no B/L B (C2): container FCL nao e dividido entre Clientes diferentes.' }))
      .toBe('Nada foi gravado: O container X esta no B/L A (C1) e no B/L B (C2): container FCL nao e dividido entre Clientes diferentes.')
    expect(atomicImportRefusalMessage({ code: '23505', message: 'duplicate key value violates unique constraint "tmp_bl_freight_import_pkey"', details: 'Key (id)=(B1) already exists.' }))
      .toBe('Nada foi gravado: O valor "B1" aparece mais de uma vez no arquivo. Deixe uma linha só para ele e importe de novo.')
    expect(atomicImportRefusalMessage({ code: 'XX000', message: 'internal error' })).toBe('Nada foi gravado: O banco recusou o arquivo.')
  })

  it('não repete "Nada foi gravado" quando a mensagem já diz', () => {
    expect(atomicImportRefusalMessage({ code: '40P01', message: 'deadlock detected' }))
      .toBe('Outra importação da mesma Viagem estava em andamento. Nada foi gravado: tente de novo.')
    expect(atomicImportRefusalMessage({ code: 'P0005', message: 'O B/L A ja esta na Viagem 1 e o arquivo foi importado na Viagem 2. Nenhum B/L do lote foi gravado.' }))
      .toBe('O B/L A ja esta na Viagem 1 e o arquivo foi importado na Viagem 2. Nenhum B/L do lote foi gravado.')
  })
})

describe('DatabaseError', () => {
  it('instancia um Error com name DatabaseError e preserva code, details, hint', () => {
    const err = new DatabaseError('falha no banco', {
      code: '42501',
      details: 'detalhe',
      hint: 'dica',
    })

    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(DatabaseError)
    expect(err.name).toBe('DatabaseError')
    expect(err.message).toBe('falha no banco')
    expect(err.code).toBe('42501')
    expect(err.details).toBe('detalhe')
    expect(err.hint).toBe('dica')
  })
})

describe('toError', () => {
  it('retorna a própria instância se já for um Error', () => {
    const original = new TypeError('conexão perdida')
    expect(toError(original)).toBe(original)
  })

  it('converte string em Error', () => {
    const err = toError('falha genérica')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('falha genérica')
  })

  it('converte objeto PostgREST ({ code, message, details, hint }) em DatabaseError', () => {
    const postgrestErr = {
      code: 'PGRST116',
      message: 'JSON object requested, multiple (or no) rows returned',
      details: 'The result contains 0 rows',
      hint: null,
    }
    const err = toError(postgrestErr)

    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(DatabaseError)
    expect((err as DatabaseError).code).toBe('PGRST116')
    expect((err as DatabaseError).details).toBe('The result contains 0 rows')
    expect(err.message).toBe('JSON object requested, multiple (or no) rows returned')
  })

  it('cria DatabaseError com extractErrorText quando o objeto não possui message explícita', () => {
    const rawObj = { code: '42501', details: 'Acesso negado pela política' }
    const err = toError(rawObj)

    expect(err).toBeInstanceOf(DatabaseError)
    expect((err as DatabaseError).code).toBe('42501')
    expect(err.message).toBe('42501 Acesso negado pela política')
  })

  it('preserva mensagem de erro genérico sem classificá-lo como banco', () => {
    const err = toError({ message: 'Falha de rede' })
    expect(err.name).toBe('Error')
    expect(err.message).toBe('Falha de rede')
  })

  it('retorna Error com mensagem padrão para valores nulos ou vazios', () => {
    expect(toError(null).message).toBe('Erro inesperado')
    expect(toError(undefined).message).toBe('Erro inesperado')
  })
})

describe('assertNoError', () => {
  it('não lança nada se o erro for nulo ou indefinido', () => {
    expect(() => assertNoError(null)).not.toThrow()
    expect(() => assertNoError(undefined)).not.toThrow()
  })

  it('lança um Error normalizado se houver erro', () => {
    expect(() => assertNoError({ message: 'violation', code: '23505' })).toThrowError(DatabaseError)
  })
})
