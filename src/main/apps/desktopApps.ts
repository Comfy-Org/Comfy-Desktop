import { CLOUD_CONFIG } from '../cloud/config'
import { catalogAppIds } from './guards'

const LIST_TIMEOUT_MS = 8000
const LIST_KEEP_MS = 60 * 60 * 1000

let list: { at: number; ids: Promise<ReadonlySet<string>> } | null = null

function desktopAppsUrl(): string {
  const query = new URLSearchParams({ type: 'app', surface: 'desktop_starters', limit: '100' })
  return `${CLOUD_CONFIG.apiBase}/v1/catalog/items?${query}`
}

async function readDesktopApps(): Promise<ReadonlySet<string>> {
  const res = await fetch(desktopAppsUrl(), { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`The catalog answered ${res.status}.`)
  return catalogAppIds(await res.json())
}

export function desktopAppIds(): Promise<ReadonlySet<string>> {
  if (!list || Date.now() - list.at > LIST_KEEP_MS) {
    const ids = readDesktopApps()
    const read = { at: Date.now(), ids }
    list = read
    ids.catch(() => {
      if (list === read) list = null
    })
  }
  return list.ids.catch(() => new Set<string>())
}
