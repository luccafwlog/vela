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
  markStartupStage,
  redactVercelTelemetryEvent,
  redactUrlQueryString,
  reportBestEffortFailure,
  reportCaughtException,
  resolveSentryDsn,
  resolveSentryEnvironment,
  setTelemetryUser,
  scrubBreadcrumbData,
  scrubEventValue,
  scrubPii,
} from '../telemetry'

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

describe('redactVercelTelemetryEvent', () => {
  it('remove query strings and normalizes identifiers from application routes', () => {
    const event = redactVercelTelemetryEvent({
      url: 'https://vela.app.br/clientes/12345678000195?tab=financeiro',
      route: '/clientes/12345678000195',
    })

    expect(event).toEqual({
      url: 'https://vela.app.br/clientes/:cnpj',
      route: '/clientes/:cnpj',
    })
  })

  it('normalizes nested inspection and manifest routes', () => {
    expect(redactVercelTelemetryEvent({
      url: 'https://portalfwlog.com.br/clientes/portal/inspecao/42?tab=operacao',
    })).toEqual({
      url: 'https://portalfwlog.com.br/clientes/portal/inspecao/:customerId',
    })

    expect(redactVercelTelemetryEvent({
      url: 'https://vela.app.br/bls/bl-123?modal=details',
    })).toEqual({
      url: 'https://vela.app.br/bls/:blId',
    })
  })

  it('preserves safe routes while removing their query strings', () => {
    expect(redactVercelTelemetryEvent({
      url: 'https://vela.app.br/painel?filter=aberto',
    })).toEqual({
      url: 'https://vela.app.br/painel',
    })
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
})
