import { stillsOf } from '../../shared/appStills'
import { APP_ID_PATTERN, isInAppsScope } from '../../shared/appsLocation'
import type { AppsLocation } from '../../shared/appsLocation'
import type { HiddenAppCard, HiddenAppPage, HiddenAppReason, HiddenAppsList } from '../../types/ipc'
import { CLOUD_CONFIG } from '../cloud/config'
import { getCloudSession } from '../devplatform/session'
import { listApps } from './appsCatalog'
import { currentAppsLocation } from './appsConfig'
import { isStaffAccount } from './draftApps'
import type { SignedInAccount } from './draftApps'
import { cloudIdentity, signedInAccount } from './draftLinks'
import { inTurns, stillDataUrl } from './stillPictures'

export const NO_HIDDEN_APPS: HiddenAppsList = Object.freeze({ apps: [] })

const CATALOG_BASE = `${CLOUD_CONFIG.apiBase}/v1/catalog`
const PAGE_LIMIT = 100
const MAX_PAGES = 10
const MAX_HIDDEN_APPS = 200
const MAX_TEXT_LENGTH = 1000
const CACHE_TTL_MS = 2 * 60 * 1000
const REFUSED_TTL_MS = 30 * 1000
const RETRY_TTL_MS = 30 * 1000
const REQUEST_TIMEOUT_MS = 8_000
const REFUSED_STATUSES: ReadonlySet<number> = new Set([401, 403])
const NO_ROUTE_STATUS = 404
const MISSING_PAGE_STATUSES: ReadonlySet<number> = new Set([404, 410])
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

interface CheckedApp {
  app: HiddenApp
  checked: boolean
}

type Loaded =
  | { kind: 'listed'; apps: HiddenApp[]; checked: boolean }
  | { kind: 'refused' }
  | { kind: 'no_route' }
  | { kind: 'unavailable' }

interface CacheEntry {
  owner: string
  expiresAt: number
  apps: HiddenApp[]
  stale: boolean
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
let inFlight: {
  owner: string
  generation: number
  request: Promise<CacheEntry | null>
} | null = null
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

async function readCatalogRows(
  token: string,
  deps: HiddenAppsDeps
): Promise<unknown[] | 'refused' | 'no_route' | 'unavailable'> {
  const rows: unknown[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await deps.fetch(staffAppsUrl(cursor), authorized(token))
    if (REFUSED_STATUSES.has(response.status)) return 'refused'
    if (response.status === NO_ROUTE_STATUS) return 'no_route'
    if (!response.ok) return 'unavailable'
    const body = asRecord(await response.json().catch(() => null))
    if (!body || !Array.isArray(body.items)) return 'unavailable'
    rows.push(...(body.items as unknown[]))
    cursor =
      body.has_more === true && typeof body.next_cursor === 'string' ? body.next_cursor : null
    if (!cursor) return rows
  }
  return rows
}

function isRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)
}

async function checkPage(pageUrl: string, deps: HiddenAppsDeps): Promise<HiddenAppPage> {
  try {
    const response = await deps.fetch(pageUrl, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (response.status === 200) return 'live'
    if (MISSING_PAGE_STATUSES.has(response.status) || isRedirect(response)) return 'missing'
    return 'unchecked'
  } catch {
    return 'unchecked'
  }
}

function pageKnownBefore(address: string, previous: HiddenApp | undefined): HiddenAppPage {
  if (previous?.card.page === 'live') return previous.pageUrl === address ? 'live' : 'unchecked'
  return previous?.card.page ?? 'unchecked'
}

async function stillOf(src: string, token: string, deps: HiddenAppsDeps): Promise<string | null> {
  try {
    return await stillDataUrl(await deps.fetch(`${CATALOG_BASE}${src}`, authorized(token)))
  } catch {
    return null
  }
}

async function hiddenAppOf(
  row: CatalogRow,
  token: string,
  location: AppsLocation,
  previous: HiddenApp | undefined,
  deps: HiddenAppsDeps
): Promise<CheckedApp> {
  const address = hiddenPageUrlOf(row.slug, location)
  const [checkedPage, still] = await Promise.all([
    address ? checkPage(address, deps) : Promise.resolve<HiddenAppPage>('missing'),
    row.picturePath ? stillOf(row.picturePath, token, deps) : Promise.resolve(null)
  ])
  const checked = checkedPage !== 'unchecked'
  const page = checked || !address ? checkedPage : pageKnownBefore(address, previous)
  return {
    checked,
    app: {
      pageUrl: page === 'live' ? address : null,
      card: {
        id: row.slug,
        title: row.title,
        description: row.description,
        covers: still ? [{ url: still, stillUrl: still }] : [],
        reasons: row.reasons,
        page
      }
    }
  }
}

function previousAppsOf(owner: string): Map<string, HiddenApp> {
  const apps = cache?.owner === owner ? cache.apps : []
  return new Map(apps.map((app) => [app.card.id, app]))
}

async function loadFor(owner: string, deps: HiddenAppsDeps): Promise<Loaded | null> {
  if (!isStaffAccount(await deps.signedInAccount())) return null
  const token = await deps.accessToken()
  if (!token || deps.cloudIdentity() !== owner) return null
  try {
    const entries = await readCatalogRows(token, deps)
    if (typeof entries === 'string') return { kind: entries }
    const rows = hiddenRows(entries, await deps.publishedAppIds())
    const location = currentAppsLocation()
    const previous = previousAppsOf(owner)
    const checkedApps = await inTurns(rows, (row) =>
      hiddenAppOf(row, token, location, previous.get(row.slug), deps)
    )
    return {
      kind: 'listed',
      apps: checkedApps.map(({ app }) => app),
      checked: checkedApps.every(({ checked }) => checked)
    }
  } catch {
    return { kind: 'unavailable' }
  }
}

function cacheAfter(owner: string, loaded: Loaded, now: number): CacheEntry {
  switch (loaded.kind) {
    case 'listed':
      return {
        owner,
        expiresAt: now + (loaded.checked ? CACHE_TTL_MS : RETRY_TTL_MS),
        apps: loaded.apps,
        stale: !loaded.checked
      }
    case 'refused':
      return { owner, expiresAt: now + REFUSED_TTL_MS, apps: [], stale: false }
    case 'no_route':
      return { owner, expiresAt: Number.POSITIVE_INFINITY, apps: [], stale: false }
    case 'unavailable':
      return {
        owner,
        expiresAt: now + RETRY_TTL_MS,
        apps: cache?.owner === owner ? cache.apps : [],
        stale: true
      }
  }
}

function startLoading(owner: string, deps: HiddenAppsDeps): Promise<CacheEntry | null> {
  const startedIn = generation
  const request = loadFor(owner, deps)
    .then((loaded) => {
      const current = startedIn === generation && deps.cloudIdentity() === owner
      if (!loaded || !current) return null
      cache = cacheAfter(owner, loaded, deps.now())
      return cache
    })
    .finally(() => {
      if (inFlight?.request === request) inFlight = null
    })
  inFlight = { owner, generation: startedIn, request }
  return request
}

function listOf(entry: CacheEntry | null): HiddenAppsList {
  if (!entry || (entry.apps.length === 0 && !entry.stale)) return NO_HIDDEN_APPS
  const apps = entry.apps.map((app) => app.card)
  return entry.stale ? { apps, stale: true } : { apps }
}

export async function listHiddenApps(deps: HiddenAppsDeps = defaultDeps): Promise<HiddenAppsList> {
  const owner = deps.cloudIdentity()
  if (owner === null) {
    forgetHiddenApps()
    return NO_HIDDEN_APPS
  }
  if (cache && cache.owner !== owner) forgetHiddenApps()
  if (cache && deps.now() < cache.expiresAt) return listOf(cache)
  const askedIn = generation
  const pending =
    inFlight?.owner === owner && inFlight.generation === askedIn
      ? inFlight.request
      : startLoading(owner, deps)
  const entry = await pending
  const current = askedIn === generation && deps.cloudIdentity() === owner
  return current ? listOf(entry) : NO_HIDDEN_APPS
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
