import { APP_ID_PATTERN, isAppsListUrl, isInAppsScope } from '../../shared/appsLocation'
import type { AppsLocation } from '../../shared/appsLocation'
import type { AppCard } from '../../types/ipc'
import { fetchJSON } from '../lib/fetch'
import { currentAppsLocation } from './appsConfig'

const LIST_FILE = 'apps.json'
const FETCH_TIMEOUT_MS = 8000
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_APPS = 200
const MAX_TEXT_LENGTH = 4096

interface ListedApp {
  card: AppCard
  pageUrl: string
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) return null
  return value.trim() || null
}

function resolved(value: unknown, base: string): URL | null {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) return null
  try {
    return new URL(value, base)
  } catch {
    return null
  }
}

export function appsListUrl(location: AppsLocation): string {
  return new URL(LIST_FILE, location.url).toString()
}

function coverUrlFor(cover: unknown, location: AppsLocation): string | null {
  const url = resolved(cover, location.url)
  return url && url.origin === location.origin ? url.href : null
}

function pageUrlFor(id: string, page: unknown, location: AppsLocation): string | null {
  const url = page === undefined ? resolved(`#/${id}`, location.url) : resolved(page, location.url)
  if (!url || !isInAppsScope(location, url.href) || isAppsListUrl(location, url.href)) return null
  return url.href
}

export function toListedApp(entry: unknown, location: AppsLocation): ListedApp | null {
  const record = asRecord(entry)
  const id = text(record?.id)
  const title = text(record?.title)
  if (!record || !id || !title || !APP_ID_PATTERN.test(id)) return null
  const pageUrl = pageUrlFor(id, record.page, location)
  if (!pageUrl) return null
  return {
    pageUrl,
    card: {
      id,
      title,
      description: text(record.blurb) ?? '',
      coverUrl: coverUrlFor(record.cover, location)
    }
  }
}

export function parseAppsList(raw: unknown, location: AppsLocation): ListedApp[] {
  if (!Array.isArray(raw)) throw new Error('The apps list is not a list')
  const seen = new Set<string>()
  const apps: ListedApp[] = []
  for (const entry of raw.slice(0, MAX_APPS)) {
    const app = toListedApp(entry, location)
    if (!app || seen.has(app.card.id)) continue
    seen.add(app.card.id)
    apps.push(app)
  }
  return apps
}

function fetchList(url: string): Promise<unknown> {
  return Promise.race([
    fetchJSON(url, { refresh: true }),
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error('The apps list request timed out')),
        FETCH_TIMEOUT_MS
      ).unref?.()
    })
  ])
}

interface CacheEntry {
  listUrl: string
  loadedAt: number
  apps: ListedApp[]
}

let cache: CacheEntry | null = null
let inFlight: { listUrl: string; request: Promise<ListedApp[]> } | null = null

function loadApps(): Promise<ListedApp[]> {
  const location = currentAppsLocation()
  const listUrl = appsListUrl(location)
  if (cache && cache.listUrl === listUrl && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return Promise.resolve(cache.apps)
  }
  if (inFlight?.listUrl === listUrl) return inFlight.request
  const request = fetchList(listUrl)
    .then((raw) => {
      const apps = parseAppsList(raw, location)
      cache = { listUrl, loadedAt: Date.now(), apps }
      return apps
    })
    .catch((err: unknown) => {
      if (cache?.listUrl === listUrl) return cache.apps
      throw err
    })
    .finally(() => {
      if (inFlight?.request === request) inFlight = null
    })
  inFlight = { listUrl, request }
  return request
}

export async function listApps(): Promise<AppCard[]> {
  return (await loadApps()).map((app) => app.card)
}

export function pageUrlForListedApp(id: string): string | null {
  return cache?.apps.find((app) => app.card.id === id)?.pageUrl ?? null
}

export function _resetAppsCatalogForTest(): void {
  cache = null
  inFlight = null
}
