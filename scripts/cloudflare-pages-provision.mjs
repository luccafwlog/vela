import { pathToFileURL } from 'node:url'

const API_BASE = 'https://api.cloudflare.com/client/v4'
const PAGE_SIZE = 100
export const PAGES_PROJECTS = Object.freeze(['vela-internal', 'vela-portal'])

class CloudflareApiError extends Error {
  constructor(method, endpoint, status) {
    super(`Cloudflare Pages API ${method} ${endpoint} failed (HTTP ${status})`)
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
      response = await fetchImpl(`${API_BASE}/accounts/${accountId}/pages/projects${path}`, {
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
      throw new CloudflareApiError(method, '/pages/projects', response.status)
    }
    if (!response.ok || payload?.success !== true) {
      throw new CloudflareApiError(method, '/pages/projects', response.status)
    }
    return payload
  }

  async function listProjects() {
    const projectsByName = new Map()
    let page = 1
    let totalPages = 1

    do {
      const payload = await request('GET', `?per_page=${PAGE_SIZE}&page=${page}`)
      if (!Array.isArray(payload.result)) {
        throw new Error('Cloudflare Pages API returned an invalid project list')
      }
      for (const project of payload.result) {
        if (typeof project?.name === 'string') projectsByName.set(project.name, project)
      }

      const reportedTotal = Number(payload.result_info?.total_pages)
      totalPages = Number.isInteger(reportedTotal) && reportedTotal > 0
        ? reportedTotal
        : payload.result.length === PAGE_SIZE ? page + 1 : page
      page += 1
    } while (page <= totalPages)

    return projectsByName
  }

  return async function ensurePagesProjects() {
    const created = []
    const existing = []
    let projectsByName = await listProjects()

    for (const name of projects) {
      if (projectsByName.has(name)) {
        existing.push(name)
        continue
      }

      try {
        const payload = await request('POST', '', {
          name,
          production_branch: 'main',
        })
        if (payload.result?.name !== name) {
          throw new Error(`Cloudflare Pages API did not confirm creation of ${name}`)
        }
        created.push(name)
        projectsByName.set(name, payload.result)
      } catch (error) {
        // A concurrent run may have created the same project after our list.
        if (error instanceof CloudflareApiError && error.status === 409) {
          projectsByName = await listProjects()
          if (projectsByName.has(name)) {
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
