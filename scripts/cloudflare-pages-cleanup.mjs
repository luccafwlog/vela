import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const API = 'https://api.cloudflare.com/client/v4'
const PROJECTS = ['vela-internal', 'vela-portal']
const PER_PAGE = 100

async function cloudflareRequest(url, { apiToken, fetchImpl, method = 'GET' }) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(method === 'DELETE' ? {} : { 'Content-Type': 'application/json' }),
    },
  })
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Cloudflare Pages API returned invalid JSON (${response.status})`)
  }
  if (!response.ok || payload.success !== true) {
    throw new Error(`Cloudflare Pages API ${method} failed (${response.status})`)
  }
  return payload
}

async function listPreviewDeployments({ project, branch, accountId, apiToken, fetchImpl }) {
  const matches = []
  for (let page = 1; page <= 1000; page += 1) {
    const url = new URL(`${API}/accounts/${accountId}/pages/projects/${encodeURIComponent(project)}/deployments`)
    url.searchParams.set('env', 'preview')
    url.searchParams.set('page', String(page))
    url.searchParams.set('per_page', String(PER_PAGE))
    const payload = await cloudflareRequest(url, { apiToken, fetchImpl })
    if (!Array.isArray(payload.result)) {
      throw new Error(`Cloudflare Pages list returned an invalid deployment list for ${project}`)
    }
    for (const deployment of payload.result) {
      if (
        deployment.environment === 'preview' &&
        deployment.deployment_trigger?.metadata?.branch === branch &&
        typeof deployment.id === 'string' && deployment.id.length > 0
      ) matches.push(deployment)
    }

    const totalPages = payload.result_info?.total_pages
    if (Number.isInteger(totalPages)) {
      if (page >= totalPages) return matches
    } else if (payload.result.length < PER_PAGE) {
      return matches
    }
  }
  throw new Error(`Cloudflare Pages pagination exceeded the safety limit for ${project}`)
}

function newestDeploymentFirst(a, b) {
  const aCreated = Date.parse(a.created_on || '')
  const bCreated = Date.parse(b.created_on || '')
  if (Number.isFinite(aCreated) && Number.isFinite(bCreated) && aCreated !== bCreated) {
    return bCreated - aCreated
  }
  return 0
}

export async function cleanupPreviewDeployments({ apiToken, accountId, branch, fetchImpl = fetch }) {
  if (!apiToken?.trim()) throw new Error('Cloudflare API token is required')
  if (!/^[a-f0-9]{32}$/i.test(accountId || '')) throw new Error('Cloudflare account ID must be 32 hexadecimal characters')
  if (!branch?.trim() || branch !== branch.trim() || branch.length > 255) {
    throw new Error('Pull request branch must be a non-empty, unpadded string of at most 255 characters')
  }

  // Cloudflare Pages does not allow deleting a branch's newest deployment.
  // Retain it (the branch alias continues to point there) and delete only older
  // exact-branch previews. Production and unrelated branches are never candidates.
  const matchesByProject = new Map()
  for (const project of PROJECTS) {
    matchesByProject.set(project, await listPreviewDeployments({ project, branch, accountId, apiToken, fetchImpl }))
  }

  const removed = Object.fromEntries(PROJECTS.map((project) => [project, 0]))
  const retained = Object.fromEntries(PROJECTS.map((project) => [project, 0]))
  for (const [project, deployments] of matchesByProject) {
    if (deployments.length === 0) continue
    const newest = [...deployments].sort(newestDeploymentFirst)[0]
    retained[project] = 1
    for (const deployment of deployments) {
      if (deployment.id === newest.id) continue
      const url = `${API}/accounts/${accountId}/pages/projects/${encodeURIComponent(project)}/deployments/${encodeURIComponent(deployment.id)}?force=true`
      await cloudflareRequest(url, { apiToken, fetchImpl, method: 'DELETE' })
      removed[project] += 1
    }
  }
  return { removed, retained }
}

async function main() {
  const result = await cleanupPreviewDeployments({
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    branch: process.env.PR_PAGES_BRANCH,
  })
  for (const [project, counts] of Object.entries(result.removed)) {
    console.log(`${project}: removed ${counts} old preview deployment(s); retained ${result.retained[project]} latest deployment(s)`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
