import { describe, expect, it, vi } from 'vitest'
import {
  evaluatePostHogFeatureFlag,
  resolveCommunicationsSendEnabled,
} from '../../../supabase/functions/_shared/postHogFeatureFlag'

describe('PostHog server-side feature flags', () => {
  it('fails closed without making a request when the project key is absent', async () => {
    const request = vi.fn()

    await expect(evaluatePostHogFeatureFlag({
      projectKey: '',
      flagKey: 'COMMUNICATIONS_ENABLED',
      request,
    })).resolves.toBe(false)

    expect(request).not.toHaveBeenCalled()
  })

  it('uses one global non-person identity and accepts only an explicit true result', async () => {
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input
      void init
      return new Response(JSON.stringify({
        featureFlags: { COMMUNICATIONS_ENABLED: true },
        errorsWhileComputingFlags: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    await expect(evaluatePostHogFeatureFlag({
      projectKey: 'phc-project-key',
      flagKey: 'COMMUNICATIONS_ENABLED',
      request,
    })).resolves.toBe(true)

    const [url, init] = request.mock.calls[0]
    expect(String(url)).toBe('https://eu.i.posthog.com/flags/?v=2')
    expect(JSON.parse(String(init?.body))).toEqual({
      token: 'phc-project-key',
      distinct_id: '$vela_global_flag',
      flag_keys_to_evaluate: ['COMMUNICATIONS_ENABLED'],
      send_event: false,
    })
  })

  it.each([
    ['flag disabled', { featureFlags: { COMMUNICATIONS_ENABLED: false } }],
    ['flag missing', { featureFlags: {} }],
    ['evaluation error', { featureFlags: { COMMUNICATIONS_ENABLED: true }, errorsWhileComputingFlags: true }],
    ['quota limited', { featureFlags: { COMMUNICATIONS_ENABLED: true }, quota_limited: true }],
  ])('fails closed for %s', async (_name, body) => {
    const request = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))

    await expect(evaluatePostHogFeatureFlag({
      projectKey: 'phc-project-key',
      flagKey: 'COMMUNICATIONS_ENABLED',
      request,
    })).resolves.toBe(false)
  })

  it('fails closed when the provider returns an error or invalid JSON', async () => {
    const unavailable = vi.fn(async () => new Response('unavailable', { status: 503 }))
    const malformed = vi.fn(async () => new Response('{', { status: 200 }))

    await expect(evaluatePostHogFeatureFlag({ projectKey: 'phc-key', flagKey: 'COMMUNICATIONS_ENABLED', request: unavailable })).resolves.toBe(false)
    await expect(evaluatePostHogFeatureFlag({ projectKey: 'phc-key', flagKey: 'COMMUNICATIONS_ENABLED', request: malformed })).resolves.toBe(false)
  })

  it('fails closed when the provider times out', async () => {
    const request = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))

    await expect(evaluatePostHogFeatureFlag({
      projectKey: 'phc-key',
      flagKey: 'COMMUNICATIONS_ENABLED',
      request,
      timeoutMs: 1,
    })).resolves.toBe(false)
  })

  it('never lets PostHog enable sending when the administrative master switch is off', async () => {
    const request = vi.fn()

    await expect(resolveCommunicationsSendEnabled({
      masterSwitchEnabled: false,
      projectKey: 'phc-project-key',
      request,
    })).resolves.toBe(false)

    expect(request).not.toHaveBeenCalled()
  })

  it('requires both the administrative master switch and the global PostHog flag', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      featureFlags: { COMMUNICATIONS_ENABLED: true },
      errorsWhileComputingFlags: false,
    }), { status: 200 }))

    await expect(resolveCommunicationsSendEnabled({
      masterSwitchEnabled: true,
      projectKey: 'phc-project-key',
      request,
    })).resolves.toBe(true)
  })
})
