import { describe, expect, it, vi } from 'vitest'
import {
  createPostHogAdapter,
  createPostHogConfig,
  FEATURE_FLAGS,
  featureFlags,
  PRODUCT_EVENTS,
  redactPostHogEvent,
} from '../featureFlags'

describe('feature flags', () => {
  it('is fail-safe before a provider is configured', () => {
    expect(featureFlags.isEnabled(FEATURE_FLAGS.COMMUNICATIONS_ENABLED)).toBe(false)
    expect(() => featureFlags.capture(PRODUCT_EVENTS.INVOICE_VIEWED)).not.toThrow()
  })

  it('returns only an explicit true flag and suppresses provider errors', () => {
    const isFeatureEnabled = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => { throw new Error('provider unavailable') })
    const adapter = createPostHogAdapter({ isFeatureEnabled, capture: vi.fn() })

    expect(adapter.isEnabled(FEATURE_FLAGS.COMMUNICATIONS_ENABLED)).toBe(true)
    expect(adapter.isEnabled(FEATURE_FLAGS.COMMUNICATIONS_ENABLED)).toBe(false)
    expect(adapter.isEnabled(FEATURE_FLAGS.COMMUNICATIONS_ENABLED)).toBe(false)
    expect(isFeatureEnabled).toHaveBeenCalledWith(FEATURE_FLAGS.COMMUNICATIONS_ENABLED, {
      send_event: false,
      defaultValue: false,
    })
  })

  it('captures aggregate properties and drops customer or voyage identifiers', () => {
    const capture = vi.fn()
    const adapter = createPostHogAdapter({ isFeatureEnabled: vi.fn(), capture })

    adapter.capture(PRODUCT_EVENTS.INVOICE_VIEWED, {
      surface: 'portal',
      invoice_type: 'local',
    })

    expect(capture).toHaveBeenCalledWith(PRODUCT_EVENTS.INVOICE_VIEWED, {
      surface: 'portal',
      invoice_type: 'local',
    })
  })

  it('removes default URL/device properties at the final provider boundary', () => {
    const event = redactPostHogEvent({
      uuid: 'event-id',
      event: PRODUCT_EVENTS.INVOICE_VIEWED,
      properties: {
        surface: 'portal',
        '$current_url': 'https://portalfwlog.com.br/portal/clientes/12.345.678/0001-95',
        email: 'client@example.com',
        customer_id_hash: 'a'.repeat(64),
        voyage_id_hash: 'b'.repeat(64),
      },
    })

    expect(event?.properties).toEqual({ surface: 'portal' })
  })

  it('disables automatic collection and recording in the provider config', () => {
    expect(createPostHogConfig('https://eu.i.posthog.com')).toMatchObject({
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      cookieless_mode: 'always',
      person_profiles: 'never',
    })
  })
})
