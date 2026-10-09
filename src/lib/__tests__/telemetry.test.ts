import { afterEach, describe, expect, it, vi } from 'vitest'

const sentryMock = vi.hoisted(() => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  init: vi.fn(),
}))

vi.mock('@sentry/react', () => sentryMock)

import {
  humanizeDatabaseError,
  isIgnoredAuthError,
  markStartupStage,
  redactUrlQueryString,
  reportBestEffortFailure,
  reportCaughtException,
  resolveSentryDsn,
  resolveSentryEnvironment,
  setTelemetryUser,
  scrubBreadcrumbData,
  scrubEventValue,
  scrubPii,
  telemetryBeforeSend,
} from '../telemetry'
import { DatabaseError } from '../errors'

afterEach(() => {
  vi.restoreAllMocks()
  sentryMock.setUser.mockReset()
  sentryMock.setTag.mockReset()
  sentryMock.captureException.mockReset()
  sentryMock.init.mockReset()
  vi.unstubAllEnvs()
})

describe('Sentry build contract', () => {
  it('uses the Portal DSN when the Portal build supplies one', () => {
    vi.stubEnv('VITE_SENTRY_DSN_PORTAL', ' https://portal.example/123 ')

    expect(resolveSentryDsn('portal')).toBe('https://portal.example/123')
  })

  it('keeps the legacy DSN as a compatibility fallback', () => {
    vi.stubEnv('VITE_SENTRY_DSN_PORTAL', '')

    expect(resolveSentryDsn('portal')).toBe(resolveSentryDsn('internal'))
  })

  it('allows Preview and Production to be classified independently', () => {
    vi.stubEnv('VITE_SENTRY_ENVIRONMENT', 'preview')

    expect(resolveSentryEnvironment()).toBe('preview')
  })
})

describe('markStartupStage', () => {
  // Achado da revisão do PR 530: Painel refaz a query a cada 90s e
  // RoutePreloader roda em toda navegação, então sem dedup cada stage
  // marcaria (e enviaria breadcrumb) sem fim durante a sessão.
  it('marca cada stage no máximo uma vez por carregamento de página', () => {
    markStartupStage('route-data')
    markStartupStage('route-data')
    markStartupStage('route-data')

    expect(performance.getEntriesByName('td-startup-route-data', 'mark')).toHaveLength(1)
  })
})

describe('reportBestEffortFailure', () => {
  it('loga um warning estruturado sem lançar', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      reportBestEffortFailure('criar alerta', new Error('boom'), { type: 'overdue' }),
    ).not.toThrow()

    expect(warn).toHaveBeenCalledTimes(1)
    const [label, detail] = warn.mock.calls[0]
    expect(label).toBe('[best-effort] criar alerta')
    expect(detail).toMatchObject({
      type: 'overdue',
      error: { name: 'Error', message: 'boom' },
    })
  })

  it('normaliza erros do PostgREST (message/code)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reportBestEffortFailure('persistir', { message: 'duplicate key', code: '23505' })
    expect(warn.mock.calls[0][1]).toMatchObject({
      error: { message: 'duplicate key', code: '23505' },
    })
  })

  it('aceita ausência de metadados', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => reportBestEffortFailure('ctx', 'falha textual')).not.toThrow()
    expect(warn.mock.calls[0][1]).toMatchObject({ error: 'falha textual' })
  })
})

describe('scrubPii', () => {
  it('redige CNPJ formatado', () => {
    expect(scrubPii('Cliente 12.345.678/0001-95 bloqueado')).toBe('Cliente [cnpj] bloqueado')
  })

  it('redige CPF formatado', () => {
    expect(scrubPii('Documento 123.456.789-09 duplicado')).toBe('Documento [cpf] duplicado')
  })

  it('redige email em mensagem estilo Postgres', () => {
    const message = 'duplicate key value violates unique constraint Key (email)=(a@b.com) already exists'
    const scrubbed = scrubPii(message)

    expect(scrubbed).toContain('[email]')
    expect(scrubbed).not.toContain('a@b.com')
  })

  it('redige sequencias nuas de 14 e 11 digitos', () => {
    expect(scrubPii('docs 12345678000195 e 12345678909')).toBe('docs [digits14] e [digits11]')
  })

  it('preserva texto sem PII', () => {
    const message = 'Erro no job 12345 para id 550e8400-e29b-41d4-a716-446655440000'
    expect(scrubPii(message)).toBe(message)
  })
})

describe('redactUrlQueryString', () => {
  // Achado 3.3 (auditoria 2026-08-12): httpContextIntegration grava
  // event.request.url = location.href antes do beforeSend rodar; telas de
  // reset/ativacao do Portal carregam o token na query string.
  it('remove a query string de uma URL com token', () => {
    expect(redactUrlQueryString('https://portalfwlog.com.br/portal/recuperar-senha?token=SEGREDO')).toBe(
      'https://portalfwlog.com.br/portal/recuperar-senha',
    )
  })

  it('preserva URL sem query string', () => {
    expect(redactUrlQueryString('https://portalfwlog.com.br/portal/login')).toBe(
      'https://portalfwlog.com.br/portal/login',
    )
  })
})

describe('scrubBreadcrumbData', () => {
  // Achado da revisão do PR 527: breadcrumbsIntegration grava
  // data.from/data.to com o href completo (path+query) em toda navegação,
  // incluindo o history.replaceState que remove o token da URL -- o
  // breadcrumb carregava o token mesmo depois da URL ficar limpa.
  it('remove a query string de campos de navegacao (from/to)', () => {
    expect(scrubBreadcrumbData({
      from: '/portal/recuperar-senha?token=SEGREDO',
      to: '/portal/recuperar-senha',
    })).toEqual({
      from: '/portal/recuperar-senha',
      to: '/portal/recuperar-senha',
    })
  })

  it('preserva valores nao textuais e redige PII em textos', () => {
    expect(scrubBreadcrumbData({
      status_code: 200,
      url: 'https://x.com/y?cnpj=12.345.678/0001-95',
    })).toEqual({
      status_code: 200,
      url: 'https://x.com/y',
    })
  })
})

describe('scrubEventValue', () => {
  it('redige objetos aninhados e preserva escalares', () => {
    expect(scrubEventValue({
      meta: { note: 'CPF 123.456.789-09' },
      count: 2,
      ok: false,
      empty: null,
    })).toEqual({
      meta: { note: 'CPF [cpf]' },
      count: 2,
      ok: false,
      empty: null,
    })
  })
})

describe('setTelemetryUser', () => {
  it('define o id e o papel do usuário no Sentry', () => {
    setTelemetryUser({ id: 'user-123', role: 'administrativo' })

    expect(sentryMock.setUser).toHaveBeenCalledWith({ id: 'user-123' })
    expect(sentryMock.setTag).toHaveBeenCalledWith('user_role', 'administrativo')
  })

  it('limpa o usuário no Sentry quando recebe null', () => {
    setTelemetryUser(null)
    expect(sentryMock.setUser).toHaveBeenCalledWith(null)
  })
})

describe('reportCaughtException', () => {
  it('envia exceção com tags contextuais mescladas', () => {
    const error = new Error('falha de teste')

    reportCaughtException(
      error,
      'TanStack Query',
      { queryKey: '["bls"]' },
      { modulo: 'Operações', tela: 'Painel de BLs', tarefa: 'Listar BLs' },
    )

    expect(sentryMock.captureException).toHaveBeenCalledWith(error, {
      tags: {
        context: 'TanStack Query',
        modulo: 'Operações',
        tela: 'Painel de BLs',
        tarefa: 'Listar BLs',
      },
      extra: { queryKey: '["bls"]' },
    })
  })

  it('converte objeto plano em DatabaseError antes de enviar ao Sentry', () => {
    const rawError = { code: '42501', message: 'permission denied' }

    reportCaughtException(rawError, 'Mutation')

    expect(sentryMock.captureException).toHaveBeenCalledTimes(1)
    const [captured] = sentryMock.captureException.mock.calls[0]
    expect(captured).toBeInstanceOf(Error)
    expect(captured.name).toBe('DatabaseError')
    expect(captured.message).toBe('permission denied')
    expect(captured.code).toBe('42501')
  })
})

type MockSentryEvent = NonNullable<Parameters<typeof telemetryBeforeSend>[0]>
const mockEvent = (event: Record<string, unknown> = {}): MockSentryEvent =>
  event as unknown as MockSentryEvent

describe('isIgnoredAuthError', () => {
  it('detecta erro de refresh token expirado / revogado no hint', () => {
    expect(
      isIgnoredAuthError(mockEvent(), {
        originalException: new Error('Invalid Refresh Token: Refresh Token Not Found'),
      }),
    ).toBe(true)
    expect(
      isIgnoredAuthError(mockEvent(), {
        originalException: { error_description: 'invalid_grant: Invalid Refresh Token' },
      }),
    ).toBe(true)
  })

  it('detecta erro de refresh token na mensagem do evento', () => {
    expect(
      isIgnoredAuthError(
        mockEvent({
          message: 'AuthApiError: Invalid Refresh Token',
        }),
      ),
    ).toBe(true)
  })

  it('retorna false para outros erros', () => {
    expect(
      isIgnoredAuthError(mockEvent(), {
        originalException: new Error('Network timeout'),
      }),
    ).toBe(false)
  })
})

describe('telemetryBeforeSend', () => {
  it('descarta eventos de Invalid Refresh Token retornando null (VELA-5)', () => {
    const event = mockEvent({
      message: 'Invalid Refresh Token',
      exception: { values: [{ type: 'AuthApiError', value: 'Invalid Refresh Token' }] },
    })

    const result = telemetryBeforeSend(event, {
      originalException: new Error('Invalid Refresh Token'),
    })

    expect(result).toBeNull()
  })

  it('normaliza exceções com títulos minificados ou de objetos crus (VELA-16 etc.)', () => {
    const event = mockEvent({
      exception: {
        values: [
          {
            type: 'qi',
            value: '',
          },
        ],
      },
    })

    const result = telemetryBeforeSend(event, {
      originalException: {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
        details: 'Key (id)=(1) already exists.',
      },
    })

    expect(result).not.toBeNull()
    expect(result!.exception!.values![0].type).toBe('DatabaseError')
    // Título legível por humanos em vez do texto cru do banco.
    expect(result!.exception!.values![0].value).toBe('[Conflito de dados] 23505')
    expect(result!.fingerprint).toEqual(['erro-banco', 'conflito', '23505', 'Este registro ja existe.'])
    expect(result!.contexts!.database).toMatchObject({
      tipo: 'Conflito de dados',
      codigo: '23505',
    })
  })

  // VELA-15: o par módulo+tarefa genérico de mutation sem chave substituía o
  // fingerprint e juntava anexo de comunicado, escala omitida, fatura avulsa e
  // TypeError na mesma issue.
  it('módulo e tarefa refinam o agrupamento sem fundir falhas diferentes', () => {
    const tags = { modulo: 'Operações', tarefa: 'Operação de dados' }
    const send = (originalException: unknown) => telemetryBeforeSend(mockEvent({
      exception: { values: [{ type: 'Fl', value: '' }] }, tags: { ...tags },
    }), { originalException })

    const fatura = send({ code: '22023', message: 'Fatura avulsa não está disponível para receber pagamento.' })
    const anexo = send({ code: '22023', message: 'O conteúdo do anexo 1 não corresponde ao tipo informado.' })
    const escala38 = send({ code: '22023', message: 'A escala da viagem 38 ja foi omitida para o POD BRSSA.' })
    const escala39 = send({ code: '22023', message: 'A escala da viagem 39 ja foi omitida para o POD BRSSA.' })
    const typeError = telemetryBeforeSend(mockEvent({
      exception: { values: [{ type: 'TypeError', value: "Cannot read properties of undefined (reading 'rest')" }] }, tags: { ...tags },
    }), { originalException: new TypeError("Cannot read properties of undefined (reading 'rest')") })

    expect(fatura!.fingerprint).toEqual(['Operações', 'Operação de dados', 'erro-banco', 'validacao', '22023', 'Fatura avulsa não está disponível para receber pagamento.'])
    expect(anexo!.fingerprint).not.toEqual(fatura!.fingerprint)
    expect(escala38!.fingerprint).toEqual(escala39!.fingerprint)
    expect(typeError!.fingerprint).toEqual(['Operações', 'Operação de dados', '{{ default }}'])
  })

  it('preserva causas e erros genéricos ao normalizar o objeto original', () => {
    const result = telemetryBeforeSend(mockEvent({
      exception: { values: [
        { type: 'TypeError', value: 'Falha na causa' },
        { type: 'Object', value: 'Objeto original' },
      ] },
    }), { originalException: { code: '23505', message: 'Chave duplicada' } })

    expect(result!.exception!.values![0]).toEqual({ type: 'TypeError', value: 'Falha na causa' })
    expect(result!.exception!.values![1].type).toBe('DatabaseError')

    const generic = telemetryBeforeSend(mockEvent({
      exception: { values: [{ type: 'Object', value: 'Falha de rede' }] },
    }), { originalException: { message: 'Falha de rede' } })
    expect(generic!.exception!.values![0].type).toBe('Error')
  })

  it('usa Error para type minificado sem evidência de banco preservando value', () => {
    const event = mockEvent({
      exception: {
        values: [
          {
            type: 'Gi',
            value: 'Falha ao processar registro',
          },
        ],
      },
    })

    const result = telemetryBeforeSend(event)

    expect(result).not.toBeNull()
    expect(result!.exception!.values![0].type).toBe('Error')
    expect(result!.exception!.values![0].value).toBe('Falha ao processar registro')
  })
})

describe('humanizeDatabaseError', () => {
  it('gera título legível para sessão expirada (caso PORTAL-2)', () => {
    const humanized = humanizeDatabaseError(
      new DatabaseError('JWT expired', { code: 'PGRST301' }),
    )

    expect(humanized).not.toBeNull()
    expect(humanized!.title).toBe('[Sessão expirada] PGRST301')
    expect(humanized!.fingerprint).toEqual(['erro-banco', 'sessao_expirada', 'PGRST301', 'Sua sessao expirou. Entre novamente para continuar.'])
    expect(humanized!.context.tipo).toBe('Sessão expirada')
    expect(humanized!.context.codigo).toBe('PGRST301')
    expect(humanized!.context.mensagem).toContain('sessao expirou')
  })

  it('aceita objeto cru do Supabase/PostgREST além da instância', () => {
    const humanized = humanizeDatabaseError({
      code: '42501',
      message: 'permission denied for table faturas',
    })

    expect(humanized!.title).toBe('[Sem permissão] 42501')
    expect(humanized!.fingerprint).toEqual(['erro-banco', 'permissao', '42501', 'Sem permissao para esta acao. Solicite acesso administrativo.'])
  })

  it('retorna null para erros que não são de banco', () => {
    expect(humanizeDatabaseError(new Error('boom'))).toBeNull()
    expect(humanizeDatabaseError('texto')).toBeNull()
    expect(humanizeDatabaseError({ message: 'sem code' })).toBeNull()
    expect(humanizeDatabaseError(null)).toBeNull()
  })

  it('redige PII do contexto antes de enviar', () => {
    const humanized = humanizeDatabaseError({
      code: '23505',
      message: 'duplicate key',
      details: 'Key (cnpj)=(12.345.678/0001-90) already exists.',
    })

    expect(humanized!.context.detalhes).not.toContain('12.345.678/0001-90')
  })

  it('anexa o contexto database no evento do beforeSend', () => {
    const result = telemetryBeforeSend(
      mockEvent({ exception: { values: [{ type: 'Ki', value: '' }] } }),
      { originalException: new DatabaseError('JWT expired', { code: 'PGRST301' }) },
    )

    expect(result!.exception!.values![0].value).toBe('[Sessão expirada] PGRST301')
    const dbContext = result!.contexts?.database as Record<string, string> | undefined
    expect(dbContext?.tipo).toBe('Sessão expirada')
  })
})
