import { pathToFileURL } from 'node:url'

const API_BASE = 'https://api.cloudflare.com/client/v4'
export const PAGES_PROJECTS = Object.freeze(['vela-internal', 'vela-portal'])

class CloudflareApiError extends Error {
  constructor(method, endpoint, status, errors = [], { accountId, apiToken } = {}) {
    const codes = Array.isArray(errors)
      ? [...new Set(errors.map((error) => error?.code).filter(Number.isInteger))]
      : []
    const messages = Array.isArray(errors)
      ? errors
        .map((error) => error?.message)
        .filter((message) => typeof message === 'string' && message.length > 0)
        .slice(0, 3)
        .map((message) => message
          .replaceAll(apiToken ?? '\0', '[redacted-token]')
          .replaceAll(accountId ?? '\0', '[redacted-account-id]')
          .replace(/Bearer\s+\S+/gi, 'Bearer [redacted-token]')
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200))
      : []
    const details = [
      ...(codes.length > 0 ? [`Cloudflare error codes: ${codes.join(', ')}`] : []),
      ...(messages.length > 0 ? [`Cloudflare error messages: ${messages.join(' | ')}`] : []),
    ]
    const detail = details.length > 0 ? `; ${details.join('; ')}` : ''
    super(`Cloudflare Pages API ${method} ${endpoint} failed (HTTP ${status}${detail})`)
    this.name = 'CloudflareApiError'
    this.status = status
  }
}

function validateCredentials(accountId, apiToken) {
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? '')) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID')
  }
  if (typeof apiToken !== 'string' || apiToken.trim().length === 0) {
    throw new Error('CLOUDFLARE_PAGES_API_TOKEN is required')
  }
}

function validateProjectNames(projects) {
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error('At least one Cloudflare Pages project is required')
  }
  if (projects.some((name) => typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name))) {
    throw new Error('Cloudflare Pages project names must contain lowercase letters, digits, or hyphens')
  }
  if (new Set(projects).size !== projects.length) {
    throw new Error('Cloudflare Pages project names must be unique')
  }
}

export function createPagesProvisioner({ accountId, apiToken, fetchImpl = fetch, projects = PAGES_PROJECTS }) {
  validateCredentials(accountId, apiToken)
  validateProjectNames(projects)

  async function request(method, path, body) {
    let response
    try {
      response = await fetchImpl(`${API_BASE}/accounts/${accountId}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new Error(`Cloudflare Pages API ${method} request failed before receiving a response`)
    }

    let payload
    try {
      payload = await response.json()
    } catch {
      throw new CloudflareApiError(method, path, response.status, [], { accountId, apiToken })
    }
    if (!response.ok || payload?.success !== true) {
      throw new CloudflareApiError(method, path, response.status, payload?.errors, { accountId, apiToken })
    }
    return payload
  }

  async function getProject(name) {
    try {
      const payload = await request('GET', `/pages/projects/${encodeURIComponent(name)}`)
      if (payload.result?.name !== name) {
        throw new Error(`Cloudflare Pages API returned an invalid project for ${name}`)
      }
      return payload.result
    } catch (error) {
      if (error instanceof CloudflareApiError && error.status === 404) return null
      throw error
    }
  }

  return async function ensurePagesProjects() {
    const created = []
    const existing = []

    for (const name of projects) {
      if (await getProject(name)) {
        existing.push(name)
        continue
      }

      try {
        const payload = await request('POST', '/pages/projects', {
          name,
          production_branch: 'main',
        })
        if (payload.result?.name !== name) {
          throw new Error(`Cloudflare Pages API did not confirm creation of ${name}`)
        }
        created.push(name)
      } catch (error) {
        // A concurrent run may have created this project after our GET.
        if (error instanceof CloudflareApiError && error.status === 409) {
          if (await getProject(name)) {
            existing.push(name)
            continue
          }
        }
        throw error
      }
    }

    return { created, existing }
  }
}

async function main() {
  const ensureProjects = createPagesProvisioner({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_PAGES_API_TOKEN,
  })
  const result = await ensureProjects()
  for (const name of result.created) console.log(`${name}: created empty Pages project`)
  for (const name of result.existing) console.log(`${name}: already exists; left unchanged`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
