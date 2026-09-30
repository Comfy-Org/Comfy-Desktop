import { net } from 'electron'
import path from 'path'
import fs from 'fs'
import { cacheDir } from './paths'
import { r2MirrorUrl } from './r2Mirror'
import { writeFileSafe } from './safe-file'

interface CacheEntry {
  etag: string
  data: unknown
}

// ETag cache (url -> { etag, data }) persisted to disk; bounded, oldest evicted first.
const MAX_CACHE_SIZE = 100
const CACHE_FILE = path.join(cacheDir(), 'fetch-cache.json')

const _cache: Map<string, CacheEntry> = new Map()
let _loaded = false

function _ensureLoaded(): void {
  if (_loaded) return
  _loaded = true
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [url, entry] of Object.entries(raw as Record<string, unknown>)) {
        if (
          entry &&
          typeof entry === 'object' &&
          'etag' in entry &&
          typeof (entry as CacheEntry).etag === 'string' &&
          'data' in entry
        ) {
          _cache.set(url, entry as CacheEntry)
        }
      }
    }
  } catch {
    // ignore — cache file may not exist yet
  }
}

function _persist(): void {
  try {
    const obj: Record<string, CacheEntry> = {}
    for (const [url, entry] of _cache) {
      obj[url] = entry
    }
    writeFileSafe(CACHE_FILE, JSON.stringify(obj))
  } catch {
    // ignore — best-effort persistence
  }
}

function _cacheSet(url: string, entry: CacheEntry): void {
  _cache.delete(url) // re-insert to refresh LRU order
  _cache.set(url, entry)
  if (_cache.size > MAX_CACHE_SIZE) {
    const oldest = _cache.keys().next().value
    if (oldest !== undefined) {
      _cache.delete(oldest)
    }
  }
  _persist()
}

function _headerString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value[0] : value
}

// Single-shot fetch with ETag negotiation. `cached` provides the If-None-Match
// value (and the 304 short-circuit body); `cacheKey` is the URL the successful
// response should be cached under, or undefined to skip writing to the cache
// entirely. Splitting these lets the mirror-retry below run WITHOUT leaking the
// primary's ETag to the mirror (cached: undefined) and WITHOUT poisoning the
// primary's persisted cache entry with mirror-tagged data (cacheKey: undefined).
function parseJson(body: string, url: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`Invalid JSON response from ${url}`)
  }
}

function fetchJSONOnce(
  url: string,
  cached: CacheEntry | undefined,
  cacheKey: string | undefined,
  parse: (body: string, url: string) => unknown = parseJson,
  timeoutMs?: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, cache: 'no-cache' })
    // `net.request` has no timeout of its own, so a stalled connection would
    // hang every caller awaiting it. `settled` keeps a late timer from
    // rejecting a request that already finished.
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish =
      <T>(fn: (v: T) => void) =>
      (value: T) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        fn(value)
      }
    const done = finish(resolve)
    const fail = finish(reject)
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        try {
          request.abort()
        } catch {}
        fail(new Error(`Timed out after ${timeoutMs}ms fetching ${url}`))
      }, timeoutMs)
      timer.unref?.()
    }
    request.setHeader('User-Agent', 'ComfyUI-Desktop-2')

    const ghToken = process.env.GITHUB_TOKEN
    if (ghToken) {
      try {
        if (new URL(url).hostname === 'api.github.com') {
          request.setHeader('Authorization', `token ${ghToken}`)
        }
      } catch {
        /* invalid URL — skip auth */
      }
    }

    if (cached?.etag) {
      request.setHeader('If-None-Match', cached.etag)
    }

    let data = ''
    request.on('response', (response) => {
      response.on('data', (chunk) => (data += chunk.toString()))
      response.on('end', () => {
        if (response.statusCode === 304 && cached) {
          done(structuredClone(cached.data))
          return
        }
        if (response.statusCode !== 200) {
          let msg = `HTTP ${response.statusCode}`
          if (response.statusCode === 403 || response.statusCode === 429) {
            const resetHeader = _headerString(response.headers['x-ratelimit-reset'])
            const retryAfter = _headerString(response.headers['retry-after'])
            let resetSecs: number | undefined
            if (resetHeader) {
              resetSecs = Math.max(0, Math.ceil(Number(resetHeader) - Date.now() / 1000))
            } else if (retryAfter) {
              resetSecs = Math.max(0, Math.ceil(Number(retryAfter)))
            }
            if (resetSecs != null) {
              const mins = Math.ceil(resetSecs / 60)
              msg += ` (rate limited — resets in ${mins} minute${mins !== 1 ? 's' : ''})`
            } else {
              msg += ' (rate limited)'
            }
          }
          fail(new Error(msg))
          return
        }
        let parsed: unknown
        try {
          parsed = parse(data, url)
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)))
          return
        }
        if (cacheKey) {
          const etag = _headerString(response.headers['etag'])
          if (etag) {
            _cacheSet(cacheKey, { etag, data: parsed })
          }
        }
        done(parsed)
      })
    })
    request.on('error', (err) => fail(err))
    request.end()
  })
}

/** @internal — exposed only for tests. */
export function _resetCacheForTest(): void {
  _cache.clear()
  _loaded = false
}

/**
 * Plain-text sibling of `fetchJSON`, sharing its `net.request` stack, ETag
 * cache, and R2-mirror retry. Used for manifests that are not JSON, such as
 * ComfyUI's `requirements.txt`.
 */
export async function fetchText(
  url: string,
  opts?: { refresh?: boolean; timeoutMs?: number }
): Promise<string> {
  const body = await fetchOne(url, opts, (text) => text)
  if (typeof body !== 'string') throw new Error(`Expected a text body from ${url}`)
  return body
}

export async function fetchJSON(
  url: string,
  opts?: { refresh?: boolean; timeoutMs?: number }
): Promise<unknown> {
  return fetchOne(url, opts, parseJson)
}

async function fetchOne(
  url: string,
  opts: { refresh?: boolean; timeoutMs?: number } | undefined,
  parse: (body: string, url: string) => unknown
): Promise<unknown> {
  _ensureLoaded()
  // `refresh` ignores the persisted ETag so the response is never served from cache. Used
  // for R2 manifests where a stale value would strand users on an old release.
  const cached = opts?.refresh ? undefined : _cache.get(url)

  try {
    return await fetchJSONOnce(url, cached, url, parse, opts?.timeoutMs)
  } catch (primaryErr) {
    // If this is an R2 URL with a configured mirror, retry once against it
    // before falling back to the persisted cache. The retry deliberately
    // discards `cached` (no ETag negotiation against the mirror) and writes
    // nothing back to the cache so a stale or compromised mirror cannot
    // poison the primary's cache entry.
    const mirror = r2MirrorUrl(url)
    if (mirror && mirror !== url) {
      try {
        return await fetchJSONOnce(mirror, undefined, undefined, parse, opts?.timeoutMs)
      } catch {
        // fall through to cache / primary error
      }
    }
    if (cached) return structuredClone(cached.data)
    throw primaryErr
  }
}
