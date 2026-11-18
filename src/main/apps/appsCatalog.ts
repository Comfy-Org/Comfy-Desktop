import { app as electronApp } from 'electron'
import path from 'path'

import { APP_ID_PATTERN, isAppsListUrl, isInAppsScope } from '../../shared/appsLocation'
import type { AppsLocation } from '../../shared/appsLocation'
import type { AppCard, AppCover } from '../../types/ipc'
import { fetchJSON } from '../lib/fetch'
import { readFileSafeAsync, writeFileSafeAsync } from '../lib/safe-file'
import { currentAppsLocation } from './appsConfig'

const LIST_FILE = 'apps.json'
const FETCH_TIMEOUT_MS = 8000
const CACHE_TTL_MS = 5 * 60 * 1000
const EMPTY_LIST_TTL_MS = 30 * 1000
const RETRY_DELAYS_MS = [1000, 3000]
const SAVED_LIST_FILE = 'apps-catalog.json'
const MAX_APPS = 200
const MAX_TEXT_LENGTH = 4096
const MAX_COVERS = 24

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

function coverFor(entry: unknown, location: AppsLocation): AppCover | null {
  const record = asRecord(entry)
  const url = coverUrlFor(record?.cover, location)
  return url ? { url, stillUrl: coverUrlFor(record?.still, location) } : null
}

function coversFor(record: JsonRecord, location: AppsLocation): AppCover[] {
  const listed = Array.isArray(record.covers) ? record.covers.slice(0, MAX_COVERS) : []
  const covers: AppCover[] = []
  for (const entry of listed) {
    const cover = coverFor(entry, location)
    if (cover && !covers.some((kept) => kept.url === cover.url)) covers.push(cover)
  }
  if (covers.length > 0) return covers
  const own = coverFor(record, location)
  return own ? [own] : []
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
      covers: coversFor(record, location)
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
  expiresAt: number
  apps: ListedApp[]
}

interface SavedList {
  listUrl: string
  apps: unknown[]
}

let cache: CacheEntry | null = null
let inFlight: { listUrl: string; request: Promise<ListedApp[]> } | null = null
let savedList: Promise<SavedList | null> | null = null

function savedListPath(): string {
  return path.join(electronApp.getPath('userData'), SAVED_LIST_FILE)
}

async function readSavedListFile(): Promise<SavedList | null> {
  try {
    const outcome = await readFileSafeAsync(savedListPath())
    if (outcome.kind !== 'data') return null
    const saved = asRecord(JSON.parse(outcome.data))
    const listUrl = saved?.listUrl
    const apps = saved?.apps
    if (typeof listUrl !== 'string' || !Array.isArray(apps)) return null
    return { listUrl, apps }
  } catch {
    return null
  }
}

async function savedAppsFor(listUrl: string, location: AppsLocation): Promise<ListedApp[] | null> {
  savedList ??= readSavedListFile()
  const saved = await savedList
  if (saved?.listUrl !== listUrl) return null
  const apps = parseAppsList(saved.apps, location)
  return apps.length > 0 ? apps : null
}

async function saveList(listUrl: string, apps: unknown[]): Promise<void> {
  savedList = Promise.resolve({ listUrl, apps })
  try {
    await writeFileSafeAsync(savedListPath(), JSON.stringify({ listUrl, apps }))
  } catch (err) {
    console.warn('[apps] could not save the apps list:', err)
  }
}

async function hasGoodList(listUrl: string, location: AppsLocation): Promise<boolean> {
  if (cache?.listUrl === listUrl && cache.apps.length > 0) return true
  return (await savedAppsFor(listUrl, location)) !== null
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.()
  })
}

async function fetchApps(listUrl: string, location: AppsLocation): Promise<ListedApp[]> {
  let failure: unknown
  for (const delay of [0, ...RETRY_DELAYS_MS]) {
    if (delay > 0) await wait(delay)
    try {
      const raw = await fetchList(listUrl)
      const apps = parseAppsList(raw, location)
      if (apps.length > 0) {
        await saveList(listUrl, raw as unknown[])
        return apps
      }
      if (!(await hasGoodList(listUrl, location))) return apps
      failure = new Error('The apps list came back empty')
    } catch (err) {
      failure = err
    }
  }
  throw failure
}

function loadApps(): Promise<ListedApp[]> {
  const location = currentAppsLocation()
  const listUrl = appsListUrl(location)
  if (cache && cache.listUrl === listUrl && Date.now() < cache.expiresAt) {
    return Promise.resolve(cache.apps)
  }
  if (inFlight?.listUrl === listUrl) return inFlight.request
  const request = fetchApps(listUrl, location)
    .then((apps) => {
      const ttl = apps.length > 0 ? CACHE_TTL_MS : EMPTY_LIST_TTL_MS
      cache = { listUrl, expiresAt: Date.now() + ttl, apps }
      return apps
    })
    .catch(async (err: unknown) => {
      if (cache?.listUrl === listUrl) return cache.apps
      const saved = await savedAppsFor(listUrl, location)
      if (!saved) throw err
      cache = { listUrl, expiresAt: 0, apps: saved }
      return saved
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
  savedList = null
}
