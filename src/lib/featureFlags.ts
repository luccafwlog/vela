import type { CaptureResult, PostHog, PostHogConfig } from 'posthog-js'

export const FEATURE_FLAGS = {
  COMMUNICATIONS_ENABLED: 'COMMUNICATIONS_ENABLED',
} as const

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS]

export const PRODUCT_EVENTS = {
  INVOICE_VIEWED: 'invoice_viewed',
  INVOICE_PAID: 'invoice_paid',
  DISPUTE_OPENED: 'dispute_opened',
} as const

export type ProductEventName = (typeof PRODUCT_EVENTS)[keyof typeof PRODUCT_EVENTS]

export type ProductEventProperties = Readonly<{
  surface?: 'portal' | 'internal'
  invoice_type?: 'local' | 'demurrage'
}>

export type FeatureFlagAdapter = Readonly<{
  isEnabled: (flag: FeatureFlagKey) => boolean
  capture: (event: ProductEventName, properties?: ProductEventProperties) => void
}>

type PostHogClient = Pick<PostHog, 'capture' | 'isFeatureEnabled'>

const POSTHOG_DEFAULT_HOST = 'https://eu.i.posthog.com'
const COOKIELESS_DISTINCT_ID = '$posthog_cookieless'
const PRODUCT_EVENT_NAMES = new Set<ProductEventName>(Object.values(PRODUCT_EVENTS))

const DISABLED_ADAPTER: FeatureFlagAdapter = Object.freeze({
  isEnabled: () => false,
  capture: () => {},
})

let activeAdapter: FeatureFlagAdapter = DISABLED_ADAPTER
let initialization: Promise<void> | null = null

function isProductEventName(event: string): event is ProductEventName {
  return PRODUCT_EVENT_NAMES.has(event as ProductEventName)
}

function sanitizeProductProperties(properties: Record<string, unknown> | undefined): Record<string, string> {
  const safe: Record<string, string> = {}
  if (!properties) return safe
  if (properties.surface === 'portal' || properties.surface === 'internal') safe.surface = properties.surface
  if (properties.invoice_type === 'local' || properties.invoice_type === 'demurrage') {
    safe.invoice_type = properties.invoice_type
  }
  return safe
}

function sanitizeProperties(
  properties: Record<string, unknown> | undefined,
  projectKey: string,
): Record<string, string | boolean> {
  return {
    token: projectKey,
    distinct_id: COOKIELESS_DISTINCT_ID,
    $cookieless_mode: true,
    ...sanitizeProductProperties(properties),
  }
}

/**
 * Final event boundary: only the named product events and allowlisted
 * properties may leave the browser. The SDK's cookieless transport requires
 * the configured project token, its shared sentinel, and its mode marker.
 * This also drops PostHog's default URL/device properties and all person data.
 */
export function redactPostHogEvent(event: CaptureResult | null, projectKey: string): CaptureResult | null {
  if (!event || !projectKey || !isProductEventName(event.event)) return null
  return {
    uuid: event.uuid,
    event: event.event,
    ...(event.timestamp ? { timestamp: event.timestamp } : {}),
    properties: sanitizeProperties(event.properties, projectKey),
  }
}

export function createPostHogConfig(apiHost: string, projectKey: string): Partial<PostHogConfig> {
  return {
    api_host: apiHost,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    cookieless_mode: 'always',
    person_profiles: 'never',
    before_send: (event) => redactPostHogEvent(event, projectKey),
  }
}

function normalizeHost(value: string | undefined): string {
  if (!value) return POSTHOG_DEFAULT_HOST
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.origin : POSTHOG_DEFAULT_HOST
  } catch {
    return POSTHOG_DEFAULT_HOST
  }
}

export function createPostHogAdapter(client: PostHogClient): FeatureFlagAdapter {
  return Object.freeze({
    isEnabled(flag: FeatureFlagKey) {
      try {
        return client.isFeatureEnabled(flag, { send_event: false, defaultValue: false }) === true
      } catch {
        return false
      }
    },
    capture(event: ProductEventName, properties?: ProductEventProperties) {
      if (!isProductEventName(event)) return
      try {
        client.capture(event, sanitizeProductProperties(properties as Record<string, unknown> | undefined))
      } catch {
        // Analytics is best-effort and must never interrupt the product flow.
      }
    },
  })
}

/** Returns false until an explicitly configured provider has loaded. */
export const featureFlags: FeatureFlagAdapter = Object.freeze({
  isEnabled: (flag) => activeAdapter.isEnabled(flag),
  capture: (event, properties) => activeAdapter.capture(event, properties),
})

/**
 * Loads PostHog only when a public project key is explicitly configured. No
 * key means no network request and the fail-safe adapter remains active.
 */
export async function initFeatureFlags(): Promise<void> {
  if (initialization) return initialization

  const key = String(import.meta.env.VITE_POSTHOG_KEY ?? '').trim()
  if (!key) return

  initialization = import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(key, createPostHogConfig(normalizeHost(import.meta.env.VITE_POSTHOG_HOST), key))
      activeAdapter = createPostHogAdapter(posthog)
    })
    .catch(() => {
      activeAdapter = DISABLED_ADAPTER
    })

  return initialization
}
