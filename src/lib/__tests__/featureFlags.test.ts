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
    const projectKey = 'phc_configured_key'
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
    }, projectKey)

    expect(event?.properties).toEqual({
      token: projectKey,
      distinct_id: '$posthog_cookieless',
      $cookieless_mode: true,
      surface: 'portal',
    })
  })

  it('preserves only the configured token, shared cookieless sentinel, and approved dimensions', () => {
    const projectKey = 'phc_public_project_key'
    const event = redactPostHogEvent({
      uuid: 'event-id',
      event: PRODUCT_EVENTS.INVOICE_VIEWED,
      timestamp: new Date('2026-09-22T12:00:00.000Z'),
      properties: {
        token: 'attacker-controlled-token',
        distinct_id: 'customer-42',
        $cookieless_mode: false,
        surface: 'portal',
        invoice_type: 'local',
        customer_id: 42,
        email: 'cliente@example.com',
        $current_url: 'https://portalfwlog.com.br/portal/faturas/42',
      },
      $set: { email: 'cliente@example.com' },
      $set_once: { customer_id: 42 },
      $unset: ['email'],
    }, projectKey)

    expect(event).toEqual({
      uuid: 'event-id',
      event: PRODUCT_EVENTS.INVOICE_VIEWED,
      timestamp: new Date('2026-09-22T12:00:00.000Z'),
      properties: {
        token: projectKey,
        distinct_id: '$posthog_cookieless',
        $cookieless_mode: true,
        surface: 'portal',
        invoice_type: 'local',
      },
    })
    expect(event?.properties).toEqual({
      token: projectKey,
      distinct_id: '$posthog_cookieless',
      $cookieless_mode: true,
      surface: 'portal',
      invoice_type: 'local',
    })
  })

  it('drops non-approved PostHog events at the final provider boundary', () => {
    expect(redactPostHogEvent({
      uuid: 'event-id',
      event: '$pageview',
      properties: { token: 'phc_public_project_key', distinct_id: '$posthog_cookieless' },
    }, 'phc_configured_key')).toBeNull()
  })

  it('binds the redaction boundary to the configured public project key', () => {
    const projectKey = 'phc_configured_key'
    const beforeSend = createPostHogConfig('https://eu.i.posthog.com', projectKey).before_send
    if (typeof beforeSend !== 'function') throw new Error('PostHog before_send callback was not configured')

    const event = beforeSend({
      uuid: 'event-id',
      event: PRODUCT_EVENTS.INVOICE_VIEWED,
      properties: { token: 'wrong-key', distinct_id: 'customer-42', $cookieless_mode: false },
    })

    expect(event?.properties).toEqual({
      token: projectKey,
      distinct_id: '$posthog_cookieless',
      $cookieless_mode: true,
    })
  })

  it('disables automatic collection and recording in the provider config', () => {
    expect(createPostHogConfig('https://eu.i.posthog.com', 'phc_configured_key')).toMatchObject({
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      cookieless_mode: 'always',
      person_profiles: 'never',
    })
  })
})
