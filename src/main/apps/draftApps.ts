import { createHash, randomUUID } from 'crypto'
import { session } from 'electron'
import type { Session } from 'electron'

import { CLOUD_CONFIG } from '../cloud/config'
import { currentAppsLocation } from './appsConfig'
import type { AppCard } from '../../types/ipc'

export const DRAFT_LINK_SCHEME = 'comfy'
export const OPEN_DRAFT_CHANNEL = 'apps:open-draft'

const OPEN_APP_HOST = 'open-app'
const PREVIEW_HOSTS = [
  /^pr-([1-9][0-9]{0,6})\.drafts\.comfy\.org$/,
  /^comfy-website-preview-pr-([1-9][0-9]{0,6})\.vercel\.app$/
]
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const LOCAL_NETWORK_NAME = /\.local$/
const IPV4_ADDRESS = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/
const DRAFT_PAGE_PATH = /^\/apps\/([a-z0-9][a-z0-9_-]{0,63})\/(?:desktop\.html)?$/
const ROOT_MOUNT = '/'
const DRAFT_MOUNT = '/apps/draft/'
const DRAFT_SLUG = 'draft'
const STAFF_EMAIL = /^[^@\s]+@comfy\.org$/i
const STAFF_SIGN_IN_PROVIDERS = new Set(['google.com', 'saml.workos', 'oidc.workos'])
const DRAFT_HEADER = 'x-comfy-draft'
const MAX_LINK_LENGTH = 2048
const MAX_TITLE_LENGTH = 80
const TITLE_TAG = /<title[^>]*>([^<]{1,200})<\/title>/i
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/gu
const DOUBLE_QUOTES = /["\u201c\u201d]/g
const SITE_TITLE_SUFFIX = /\s*[·|]\s*Comfy$/
const TITLE_FETCH_TIMEOUT_MS = 5_000
const MAX_TITLE_PAGE_BYTES = 64 * 1024
const CLOUD_ORIGIN = new URL(CLOUD_CONFIG.issuer).origin
const PLACE_HASH_LENGTH = 8

export interface DraftLink {
  origin: string
  path: string
  slug: string
  pr: number | null
  mount: string
}

export interface DraftApp extends DraftLink {
  id: string
  owner: string
  card: AppCard
  accepted: boolean
  token: string | null
}

export interface AskedDraft extends DraftApp {
  token: string
}

const drafts = new Map<string, DraftApp>()
const draftSessions = new Map<string, Session>()

function urlOf(text: string): URL | null {
  try {
    return new URL(text)
  } catch {
    return null
  }
}

function pageInLink(link: string): URL | null {
  const outer = urlOf(link)
  if (!outer || outer.protocol !== `${DRAFT_LINK_SCHEME}:` || outer.hostname !== OPEN_APP_HOST) {
    return null
  }
  const target = outer.searchParams.get('url')
  return target ? urlOf(target) : null
}

function previewPrOf(page: URL): number | null {
  if (page.protocol !== 'https:' || page.port !== '') return null
  for (const host of PREVIEW_HOSTS) {
    const preview = host.exec(page.hostname)
    if (preview) return Number(preview[1])
  }
  return null
}

function isPrivateNetworkAddress(hostname: string): boolean {
  const parts = IPV4_ADDRESS.exec(hostname)
  if (!parts) return false
  const first = Number(parts[1])
  const second = Number(parts[2])
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

export function isLocalHost(hostname: string): boolean {
  return (
    LOOPBACK_HOSTS.has(hostname) ||
    LOCAL_NETWORK_NAME.test(hostname) ||
    isPrivateNetworkAddress(hostname)
  )
}

export function isComfyAddress(link: DraftLink): boolean {
  return link.pr !== null || isLocalHost(new URL(link.origin).hostname)
}

function hasSignIn(page: URL): boolean {
  return page.username !== '' || page.password !== ''
}

function appPageDraft(page: URL, slug: string): DraftLink {
  return {
    origin: page.origin,
    path: page.pathname + page.search,
    slug,
    pr: previewPrOf(page),
    mount: ROOT_MOUNT
  }
}

function isWebPage(page: URL): boolean {
  return page.protocol === 'https:' || (page.protocol === 'http:' && isLocalHost(page.hostname))
}

function draftAt(page: URL | null): DraftLink | null {
  if (!page || !isWebPage(page) || hasSignIn(page)) return null
  const slug = DRAFT_PAGE_PATH.exec(page.pathname)?.[1]
  if (slug) return appPageDraft(page, slug)
  return {
    origin: page.origin,
    path: DRAFT_MOUNT + page.pathname.slice(1) + page.search,
    slug: DRAFT_SLUG,
    pr: previewPrOf(page),
    mount: DRAFT_MOUNT
  }
}

export function parseDraftLink(link: unknown): DraftLink | null {
  if (typeof link !== 'string' || link.length > MAX_LINK_LENGTH) return null
  return draftAt(pageInLink(link))
}

export function parsePastedDraft(address: unknown): DraftLink | null {
  if (typeof address !== 'string') return null
  const text = address.trim()
  if (text.length > MAX_LINK_LENGTH) return null
  return draftAt(text.startsWith(`${DRAFT_LINK_SCHEME}:`) ? pageInLink(text) : urlOf(text))
}

function placeHashOf(link: DraftLink): string {
  return createHash('sha256')
    .update(sessionKeyOf(link.origin, link.mount))
    .digest('hex')
    .slice(0, PLACE_HASH_LENGTH)
}

export function draftIdOf(link: DraftLink): string {
  const source =
    link.pr === null
      ? new URL(link.origin).host.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      : `pr${link.pr}`
  return `draft-${source}-${link.slug}-${placeHashOf(link)}`
}

export function draftSourceOf(link: DraftLink): string {
  return new URL(link.origin).host
}

export interface SignedInAccount {
  email?: string
  signInProvider?: string
}

export function isStaffAccount(account: SignedInAccount | null): boolean {
  return (
    typeof account?.email === 'string' &&
    STAFF_EMAIL.test(account.email) &&
    typeof account.signInProvider === 'string' &&
    STAFF_SIGN_IN_PROVIDERS.has(account.signInProvider)
  )
}

export function titleFromPage(html: string, slug: string): string {
  const found = TITLE_TAG.exec(html)?.[1]
    ?.replace(/\s+/g, ' ')
    .replace(HIDDEN_CHARACTERS, '')
    .replace(DOUBLE_QUOTES, "'")
    .trim()
    .replace(SITE_TITLE_SUFFIX, '')
  if (found) return found.slice(0, MAX_TITLE_LENGTH)
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ')
}

export function draftCard(id: string, link: DraftLink, title: string): AppCard {
  const source = draftSourceOf(link)
  return {
    id,
    title,
    description: `Draft from ${source}`,
    covers: [],
    badges: [
      {
        id: 'draft',
        style: 'chip',
        text: { en: 'Draft' },
        description: { en: `Not published. From ${source}.` }
      }
    ]
  }
}

function appsOrigin(): string {
  return currentAppsLocation().origin
}

export function mapToDraftOrigin(requestUrl: string, origin: string, mount: string): string | null {
  const url = new URL(requestUrl)
  if (url.origin !== appsOrigin()) return null
  const path = url.pathname.startsWith(mount)
    ? `/${url.pathname.slice(mount.length)}`
    : url.pathname
  return new URL(`${origin}${path}${url.search}`).href
}

export function sameSiteHeaders(headers: Headers): Headers {
  const forwarded = new Headers(headers)
  forwarded.delete('origin')
  return forwarded
}

export function draftTagOf(origin: string): string {
  const site = new URL(origin)
  const pr = previewPrOf(site)
  return pr === null ? site.host : `pr-${pr}`
}

export function cloudHeaders(requestUrl: string, headers: Headers, tag: string): Headers {
  const forwarded = new Headers(headers)
  if (new URL(requestUrl).origin === CLOUD_ORIGIN) forwarded.set(DRAFT_HEADER, tag)
  return forwarded
}

function forward(
  draft: Session,
  request: Request,
  url: string,
  headers: Headers
): Promise<Response> {
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null
  return draft.fetch(url, {
    method: request.method,
    headers,
    ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
    bypassCustomProtocolHandlers: true
  } as RequestInit)
}

function sessionKeyOf(origin: string, mount: string): string {
  return mount === ROOT_MOUNT ? origin : `${origin} ${mount}`
}

function handledSchemes(): Set<string> {
  return new Set(['https', new URL(appsOrigin()).protocol.slice(0, -1)])
}

export function draftSession(origin: string, mount: string): Session {
  const key = sessionKeyOf(origin, mount)
  const known = draftSessions.get(key)
  if (known) return known
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 16)
  const draft = session.fromPartition(`comfy-apps-draft-${hash}`)
  const tag = draftTagOf(origin)
  const handler = (request: Request): Promise<Response> => {
    const mapped = mapToDraftOrigin(request.url, origin, mount)
    if (mapped) return forward(draft, request, mapped, sameSiteHeaders(request.headers))
    return forward(draft, request, request.url, cloudHeaders(request.url, request.headers, tag))
  }
  for (const scheme of handledSchemes()) draft.protocol.handle(scheme, handler)
  draftSessions.set(key, draft)
  return draft
}

function draftSourceUrl(link: DraftLink): string {
  return mapToDraftOrigin(new URL(link.path, appsOrigin()).href, link.origin, link.mount)!
}

function isSameSource(known: DraftLink, link: DraftLink): boolean {
  return known.origin === link.origin && known.path === link.path && known.mount === link.mount
}

async function readPageStart(page: Response, signal: AbortSignal): Promise<string> {
  const reader = page.body?.getReader()
  if (!reader) return ''
  const stop = (): void => void reader.cancel().catch(() => {})
  signal.addEventListener('abort', stop, { once: true })
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    while (bytes < MAX_TITLE_PAGE_BYTES && !TITLE_TAG.test(text)) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    signal.removeEventListener('abort', stop)
    stop()
  }
  return text
}

async function readDraftPage(link: DraftLink, signal: AbortSignal): Promise<string> {
  const page = await draftSession(link.origin, link.mount).fetch(draftSourceUrl(link), {
    bypassCustomProtocolHandlers: true,
    signal
  })
  return page.ok ? readPageStart(page, signal) : ''
}

async function draftPageStart(link: DraftLink): Promise<string> {
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), TITLE_FETCH_TIMEOUT_MS)
  const timedOut = new Promise<string>((resolve) => {
    deadline.signal.addEventListener('abort', () => resolve(''), { once: true })
  })
  try {
    return await Promise.race([readDraftPage(link, deadline.signal), timedOut])
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
    deadline.abort()
  }
}

export async function registerDraft(
  link: DraftLink,
  owner: string,
  isStillOwner: () => boolean
): Promise<AskedDraft | null> {
  const id = draftIdOf(link)
  const title = titleFromPage(await draftPageStart(link), link.slug)
  if (!isStillOwner()) return null
  const known = drafts.get(id)
  const draft: AskedDraft = {
    ...link,
    id,
    owner,
    card: draftCard(id, link, title),
    accepted:
      known !== undefined && known.owner === owner && isSameSource(known, link) && known.accepted,
    token: randomUUID()
  }
  drafts.set(id, draft)
  return draft
}

export function draftOf(appId: string): DraftApp | null {
  return drafts.get(appId) ?? null
}

export function draftAskedWith(token: string): DraftApp | null {
  if (token === '') return null
  return [...drafts.values()].find((draft) => draft.token === token) ?? null
}

export function confirmDraft(token: string): AppCard | null {
  const draft = draftAskedWith(token)
  if (!draft) return null
  draft.token = null
  draft.accepted = true
  return draft.card
}

export function draftPageUrl(appId: string): string | null {
  const draft = drafts.get(appId)
  return draft?.accepted ? new URL(draft.path, appsOrigin()).href : null
}

export function revokeDraft(appId: string): void {
  const draft = drafts.get(appId)
  if (draft) draft.accepted = false
}

export function forgetDrafts(): void {
  drafts.clear()
}

export function hasDrafts(): boolean {
  return drafts.size > 0
}

export function draftsBelongTo(owner: string | null): boolean {
  return [...drafts.values()].every((draft) => draft.owner === owner)
}

export function draftCards(): AppCard[] {
  return [...drafts.values()].filter((draft) => draft.accepted).map((draft) => draft.card)
}

export function findDraftLink(argv: readonly string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${DRAFT_LINK_SCHEME}://`)) ?? null
}

export function _resetForTest(): void {
  drafts.clear()
  draftSessions.clear()
}
