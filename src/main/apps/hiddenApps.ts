import { stillsOf } from '../../shared/appStills'
import { APP_ID_PATTERN, isInAppsScope } from '../../shared/appsLocation'
import type { AppsLocation } from '../../shared/appsLocation'
import type { HiddenAppCard, HiddenAppReason, HiddenAppsList } from '../../types/ipc'
import { CLOUD_CONFIG } from '../cloud/config'
import { getCloudSession } from '../devplatform/session'
import { listApps } from './appsCatalog'
import { currentAppsLocation } from './appsConfig'
import { isStaffAccount } from './draftApps'
import type { SignedInAccount } from './draftApps'
import { cloudIdentity, signedInAccount } from './draftLinks'

export const NO_HIDDEN_APPS: HiddenAppsList = Object.freeze({ apps: [] })

const CATALOG_BASE = `${CLOUD_CONFIG.apiBase}/v1/catalog`
const PAGE_LIMIT = 100
const MAX_PAGES = 10
const MAX_HIDDEN_APPS = 200
const MAX_TEXT_LENGTH = 1000
const CACHE_TTL_MS = 2 * 60 * 1000
const REFUSED_TTL_MS = 30 * 1000
const REQUEST_TIMEOUT_MS = 8_000
const MAX_PARALLEL_REQUESTS = 6
const MAX_STILL_BYTES = 2 * 1024 * 1024
const STILL_TYPES: ReadonlySet<string> = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
])
const PICTURE_PATH = /^\/staff-apps\/[0-9a-f-]{36}\/picture\/[0-9a-f-]{36}$/i

export interface HiddenAppsDeps {
  signedInAccount: () => Promise<SignedInAccount | null>
  accessToken: () => Promise<string | null>
  cloudIdentity: () => string | null
  publishedAppIds: () => Promise<readonly string[]>
  fetch: (url: string, init: RequestInit) => Promise<Response>
  now: () => number
}

interface HiddenApp {
  card: HiddenAppCard
  pageUrl: string | null
}

interface CatalogRow {
  slug: string
  title: string
  description: string
  reasons: HiddenAppReason[]
  picturePath: string | null
}

interface Loaded {
  apps: HiddenApp[]
  ttl: number
}

interface CacheEntry {
  owner: string
  expiresAt: number
  apps: HiddenApp[]
}

const defaultDeps: HiddenAppsDeps = {
  signedInAccount,
  accessToken: () => getCloudSession().getGrantAccessToken(),
  cloudIdentity,
  publishedAppIds: async () => (await listApps()).map((app) => app.id),
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now()
}

let cache: CacheEntry | null = null
let inFlight: { owner: string; generation: number; request: Promise<HiddenApp[]> } | null = null
let generation = 0

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function text(value: unknown): string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value.trim() : ''
}

function reasonsOf(row: JsonRecord): HiddenAppReason[] {
  const reasons: HiddenAppReason[] = []
  if (row.enabled === false) reasons.push('off')
  if (row.status === 'not_live') reasons.push('draft')
  if (row.on_desktop === false) reasons.push('hub_only')
  if (row.status === 'unpublished') reasons.push('unpublished')
  return reasons
}

function pictureOf(row: JsonRecord): string | null {
  return typeof row.picture === 'string' && PICTURE_PATH.test(row.picture) ? row.picture : null
}

function toCatalogRow(entry: unknown): CatalogRow | null {
  const row = asRecord(entry)
  if (!row) return null
  const slug = text(row.slug)
  if (!APP_ID_PATTERN.test(slug)) return null
  return {
    slug,
    title: text(row.title) || slug,
    description: text(row.description),
    reasons: reasonsOf(row),
    picturePath: pictureOf(row)
  }
}

function hiddenRows(entries: readonly unknown[], published: readonly string[]): CatalogRow[] {
  const seen = new Set(published)
  const rows: CatalogRow[] = []
  for (const entry of entries) {
    const row = toCatalogRow(entry)
    if (!row || seen.has(row.slug)) continue
    seen.add(row.slug)
    rows.push(row)
    if (rows.length === MAX_HIDDEN_APPS) break
  }
  return rows
}

export function hiddenPageUrlOf(slug: string, location: AppsLocation): string | null {
  const url = new URL(`/apps/${slug}/desktop.html`, location.origin).href
  return isInAppsScope(location, url) ? url : null
}

function staffAppsUrl(cursor: string | null): string {
  const url = new URL(`${CATALOG_BASE}/staff-apps`)
  url.searchParams.set('limit', String(PAGE_LIMIT))
  if (cursor) url.searchParams.set('cursor', cursor)
  return url.href
}

function authorized(token: string): RequestInit {
  return {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }
}

async function readCatalogRows(token: string, deps: HiddenAppsDeps): Promise<unknown[] | null> {
  const rows: unknown[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await deps.fetch(staffAppsUrl(cursor), authorized(token))
    if (!response.ok) return null
    const body = asRecord(await response.json().catch(() => null))
    if (!body || !Array.isArray(body.items)) return null
    rows.push(...(body.items as unknown[]))
    cursor =
      body.has_more === true && typeof body.next_cursor === 'string' ? body.next_cursor : null
    if (!cursor) return rows
  }
  return rows
}

async function pageExists(pageUrl: string, deps: HiddenAppsDeps): Promise<boolean> {
  try {
    const response = await deps.fetch(pageUrl, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    return response.status === 200
  } catch {
    return false
  }
}

async function readCapped(response: Response): Promise<Uint8Array | null> {
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_STILL_BYTES) return null
      chunks.push(value)
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
  return size > 0 ? Buffer.concat(chunks) : null
}

function stillTypeOf(response: Response): string | null {
  const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  return type && STILL_TYPES.has(type) ? type : null
}

async function stillOf(src: string, token: string, deps: HiddenAppsDeps): Promise<string | null> {
  try {
    const response = await deps.fetch(`${CATALOG_BASE}${src}`, authorized(token))
    const type = stillTypeOf(response)
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (!response.ok || !type || declared > MAX_STILL_BYTES) {
      void response.body?.cancel().catch(() => {})
      return null
    }
    const bytes = await readCapped(response)
    return bytes ? `data:${type};base64,${Buffer.from(bytes).toString('base64')}` : null
  } catch {
    return null
  }
}

async function inTurns<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_REQUESTS, items.length) }, worker))
  return results
}

async function hiddenAppOf(
  row: CatalogRow,
  token: string,
  location: AppsLocation,
  deps: HiddenAppsDeps
): Promise<HiddenApp> {
  const address = hiddenPageUrlOf(row.slug, location)
  const [hasPage, still] = await Promise.all([
    address ? pageExists(address, deps) : Promise.resolve(false),
    row.picturePath ? stillOf(row.picturePath, token, deps) : Promise.resolve(null)
  ])
  const pageUrl = hasPage ? address : null
  return {
    pageUrl,
    card: {
      id: row.slug,
      title: row.title,
      description: row.description,
      covers: still ? [{ url: still, stillUrl: still }] : [],
      reasons: row.reasons,
      hasPage: pageUrl !== null
    }
  }
}

async function loadFor(owner: string, deps: HiddenAppsDeps): Promise<Loaded | null> {
  if (!isStaffAccount(await deps.signedInAccount())) return null
  const token = await deps.accessToken()
  if (!token || deps.cloudIdentity() !== owner) return null
  const refused: Loaded = { apps: [], ttl: REFUSED_TTL_MS }
  try {
    const entries = await readCatalogRows(token, deps)
    if (!entries) return refused
    const rows = hiddenRows(entries, await deps.publishedAppIds())
    const location = currentAppsLocation()
    const apps = await inTurns(rows, (row) => hiddenAppOf(row, token, location, deps))
    return { apps, ttl: CACHE_TTL_MS }
  } catch {
    return refused
  }
}

function startLoading(owner: string, deps: HiddenAppsDeps): Promise<HiddenApp[]> {
  const startedIn = generation
  const request = loadFor(owner, deps)
    .then((loaded) => {
      const current = startedIn === generation && deps.cloudIdentity() === owner
      if (!loaded || !current) return []
      cache = { owner, expiresAt: deps.now() + loaded.ttl, apps: loaded.apps }
      return loaded.apps
    })
    .finally(() => {
      if (inFlight?.request === request) inFlight = null
    })
  inFlight = { owner, generation: startedIn, request }
  return request
}

function listOf(apps: readonly HiddenApp[]): HiddenAppsList {
  return apps.length > 0 ? { apps: apps.map((app) => app.card) } : NO_HIDDEN_APPS
}

export async function listHiddenApps(deps: HiddenAppsDeps = defaultDeps): Promise<HiddenAppsList> {
  const owner = deps.cloudIdentity()
  if (owner === null) {
    forgetHiddenApps()
    return NO_HIDDEN_APPS
  }
  if (cache && cache.owner !== owner) forgetHiddenApps()
  if (cache && deps.now() < cache.expiresAt) return listOf(cache.apps)
  const pending =
    inFlight?.owner === owner && inFlight.generation === generation
      ? inFlight.request
      : startLoading(owner, deps)
  const apps = await pending
  return deps.cloudIdentity() === owner ? listOf(apps) : NO_HIDDEN_APPS
}

function currentHiddenApp(id: string, deps: HiddenAppsDeps): HiddenApp | null {
  if (!cache || cache.owner !== deps.cloudIdentity()) return null
  return cache.apps.find((app) => app.card.id === id) ?? null
}

export function pageUrlForHiddenApp(id: string, deps: HiddenAppsDeps = defaultDeps): string | null {
  const pageUrl = currentHiddenApp(id, deps)?.pageUrl ?? null
  return pageUrl && isInAppsScope(currentAppsLocation(), pageUrl) ? pageUrl : null
}

export function titleForHiddenApp(id: string, deps: HiddenAppsDeps = defaultDeps): string | null {
  return currentHiddenApp(id, deps)?.card.title ?? null
}

export function pictureForHiddenApp(id: string, deps: HiddenAppsDeps = defaultDeps): string | null {
  const app = currentHiddenApp(id, deps)
  return app ? (stillsOf(app.card)[0] ?? null) : null
}

export function forgetHiddenApps(): void {
  generation += 1
  cache = null
  inFlight = null
}
