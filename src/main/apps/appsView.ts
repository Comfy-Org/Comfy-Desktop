import { app, ipcMain, session, shell, WebContentsView } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent, Session, WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { promises as fsp } from 'fs'
import path from 'path'

import { CLOUD_CONFIG } from '../cloud/config'
import { getCloudSession } from '../devplatform/session'
import { comfyWindows } from '../host/registry'
import { signInToCloud } from '../lib/ipc/registerDevPlatformHandlers'
import * as settings from '../settings'
import {
  appsOrigin,
  appsUrl,
  cleanSaveName,
  collectOutputs,
  isAppOpen,
  isAllowedAppsPermission,
  isAppsFrameUrl,
  isDocumentFailure,
  isInside,
  isPageLoadFailure,
  isRunId,
  isVersionsIndex,
  isWorkflow,
  inJobGrace,
  jobsAnswer,
  MAX_RESULT_BYTES,
  MAX_SAVE_BYTES,
  MAX_UPLOAD_BYTES,
  noteSubmitted,
  readCapped,
  type OutputFile,
  readable,
  type OutputKind,
  saveExt,
  savedFileName,
  toOutputFile,
  uploadForm,
  VERSIONS_FILE
} from './guards'
import { stallGuard, streamToFile } from './download'
import {
  cancelSetup,
  getLocal,
  initLocalComfy,
  localDownload,
  localFetch,
  startLocal,
  syncLocalSocket
} from './localComfy'
import { localBuilds, openInComfy } from './openInComfy'

const APPS_URL = appsUrl(process.env, app.isPackaged)
const APPS_ORIGIN = appsOrigin(APPS_URL)
const APPS_PARTITION = 'persist:comfy-apps'

const views = new Map<number, WebContentsView>()

const failedViews = new WeakSet<WebContentsView>()

export const APPS_LOAD_FAILED_CHANNEL = 'comfy-apps:load-failed'
export const APPS_APP_OPEN_CHANNEL = 'comfy-apps:app-open'

const appOpen = new Map<number, boolean>()

export interface AppsRect {
  x: number
  y: number
  width: number
  height: number
  fresh?: boolean
}

export type AppsAuthState = { signedIn: false } | { signedIn: true; email?: string }

function openOutside(url: string): void {
  if (url.startsWith('https://')) void shell.openExternal(url)
}

function tellPanelLoadFailed(panel: WebContents | undefined, url: string): void {
  if (panel && !panel.isDestroyed()) panel.send(APPS_LOAD_FAILED_CHANNEL, { url })
}

function tellPanelAppOpen(key: number): void {
  const panel = comfyWindows.get(key)?.panelView?.webContents
  if (panel && !panel.isDestroyed())
    panel.send(APPS_APP_OPEN_CHANNEL, { open: appOpen.get(key) === true })
}

function trackAppOpen(key: number, url: string): void {
  appOpen.set(key, isAppOpen(url, APPS_URL))
  tellPanelAppOpen(key)
}

function markLoadFailed(key: number, view: WebContentsView, url: string): void {
  failedViews.add(view)
  view.setVisible(false)
  tellPanelLoadFailed(comfyWindows.get(key)?.panelView?.webContents, url || APPS_URL)
}

let securedSession: Session | null = null

function secureAppsSession(): void {
  const appsSession = session.fromPartition(APPS_PARTITION)
  if (securedSession === appsSession) return
  appsSession.setPermissionCheckHandler((_contents, permission) =>
    isAllowedAppsPermission(permission)
  )
  appsSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(isAllowedAppsPermission(permission))
  )
  securedSession = appsSession
}

function keepOnAppsOrigin(event: { preventDefault(): void }, url: string): void {
  if (isAppsFrameUrl(url, APPS_ORIGIN)) return
  event.preventDefault()
  openOutside(url)
}

function createAppsView(key: number): WebContentsView {
  secureAppsSession()
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/appsPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: APPS_PARTITION
    }
  })
  view.setBorderRadius(14)
  const wc = view.webContents
  wc.on('will-navigate', keepOnAppsOrigin)
  wc.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame) keepOnAppsOrigin(event, url)
  })
  wc.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  wc.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
    if (isMainFrame && isPageLoadFailure(errorCode)) markLoadFailed(key, view, url)
  })
  wc.on('did-navigate', (_event, url, httpResponseCode) => {
    if (isDocumentFailure(httpResponseCode)) markLoadFailed(key, view, url)
    trackAppOpen(key, url)
  })
  wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) trackAppOpen(key, url)
  })
  wc.loadURL(APPS_URL).catch(() => {})
  return view
}

function entryForPanel(
  sender: WebContents
): [number, NonNullable<ReturnType<typeof comfyWindows.get>>] | null {
  for (const [key, entry] of comfyWindows) {
    if (entry.panelView?.webContents === sender) return [key, entry]
  }
  return null
}

function showApps(event: IpcMainEvent, rect: unknown): void {
  const found = entryForPanel(event.sender)
  if (!found) return
  if (!APPS_ORIGIN) return tellPanelLoadFailed(event.sender, APPS_URL)
  const [key, entry] = found
  const r = rect as Partial<AppsRect> | null
  if (!r || ![r.x, r.y, r.width, r.height].every((n) => typeof n === 'number' && isFinite(n)))
    return
  let view = views.get(key)
  if (view?.webContents.isDestroyed()) view = undefined
  if (view && failedViews.has(view)) {
    if (r.fresh !== true) return
    failedViews.delete(view)
    view.webContents.loadURL(APPS_URL).catch(() => {})
  }
  if (!view) {
    view = createAppsView(key)
    views.set(key, view)
    entry.window.once('closed', () => {
      views.delete(key)
      appOpen.delete(key)
      if (!view!.webContents.isDestroyed()) view!.webContents.close()
      syncLocalSocket()
    })
  }
  const panel = entry.panelView!.getBounds()
  view.setBounds({
    x: Math.round(panel.x + r.x!),
    y: Math.round(panel.y + r.y!),
    width: Math.round(r.width!),
    height: Math.round(r.height!)
  })
  entry.window.contentView.addChildView(view)
  view.setVisible(true)
  if (r.fresh === true) tellPanelAppOpen(key)
}

function hideApps(event: IpcMainEvent): void {
  const found = entryForPanel(event.sender)
  if (!found) return
  views.get(found[0])?.setVisible(false)
}

function fromAppsPage(event: IpcMainInvokeEvent): boolean {
  const ours = [...views.values()].some((v) => v.webContents === event.sender)
  const frame = event.senderFrame
  return (
    ours && !!frame && frame === event.sender.mainFrame && isAppsFrameUrl(frame.url, APPS_ORIGIN)
  )
}

function authState(): AppsAuthState {
  const status = getCloudSession().status()
  return status.signedIn ? { signedIn: true, email: status.email } : { signedIn: false }
}

const CLOUD_TIMEOUT_MS = 120_000
const DOWNLOAD_STALL_MS = 60_000

async function cloudFetch(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  const token = await getCloudSession().getAccessToken()
  if (!token) throw new Error('Sign in to Comfy to use apps.')
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const signal = init.signal ?? AbortSignal.timeout(CLOUD_TIMEOUT_MS)
  return fetch(`${CLOUD_CONFIG.apiBase}${pathAndQuery}`, { ...init, headers, signal }).catch(
    (err: unknown) => {
      if ((err as Error)?.name === 'TimeoutError') {
        throw new Error('Comfy Cloud took too long to answer.')
      }
      throw err
    }
  )
}

async function failure(res: Response): Promise<Error> {
  if (res.status === 429) return new Error('Comfy Cloud is busy. Try again in a minute.')
  const body = await res.text().catch(() => '')
  const text = res.headers.get('content-type')?.includes('html') ? '' : `: ${body.slice(0, 300)}`
  return new Error(`Comfy Cloud answered ${res.status}${text}`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const MAX_BUSY_RETRIES = 4

function busyDelay(res: Response, attempt: number): number {
  const asked = Number(res.headers.get('retry-after'))
  return asked > 0 ? Math.min(asked, 30) * 1000 : 2000 * (attempt + 1)
}

async function cloudFetchRetrying(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await cloudFetch(pathAndQuery, init)
    if (res.status !== 429 || attempt === MAX_BUSY_RETRIES) return res
    await sleep(busyDelay(res, attempt))
  }
}

async function cloudDownload<T>(
  pathAndQuery: string,
  read: (res: Response, alive: () => void) => Promise<T>
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const stall = stallGuard(DOWNLOAD_STALL_MS)
    let res: Response | undefined
    let delay: number
    try {
      res = await cloudFetch(pathAndQuery, { signal: stall.signal })
      if (res.status !== 429 || attempt === MAX_BUSY_RETRIES) {
        if (!res.ok) throw await failure(res)
        return await read(res, stall.alive)
      }
      delay = busyDelay(res, attempt)
      await res.body?.cancel().catch(() => {})
    } catch (err) {
      await res?.body?.cancel().catch(() => {})
      if (stall.signal.aborted)
        throw new Error('Comfy Cloud stopped sending the result.', { cause: err })
      throw err
    } finally {
      stall.stop()
    }
    await sleep(delay)
  }
}

interface NodeError {
  class_type?: string
  errors?: Array<{ message?: string; details?: string }>
}

async function run(workflow: unknown): Promise<{ runId: string }> {
  if (!isWorkflow(workflow)) throw new Error('That is not a workflow.')
  const token = await getCloudSession().getAccessToken()
  if (!token) throw new Error('Sign in to Comfy to use apps.')
  const res = await cloudFetch('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, extra_data: { auth_token_comfy_org: token } })
  })
  if (!res.ok) throw await failure(res)
  const body = (await res.json()) as { prompt_id?: string; node_errors?: Record<string, NodeError> }
  const refused = Object.entries(body.node_errors ?? {})[0]
  if (refused) {
    const [node, e] = refused
    const why = e.errors?.[0]?.details || e.errors?.[0]?.message || 'refused'
    throw new Error(`Comfy Cloud would not run node ${node} (${e.class_type ?? 'unknown'}): ${why}`)
  }
  if (!isRunId(body.prompt_id)) throw new Error('Comfy Cloud did not start the run.')
  noteSubmitted(submittedRuns, body.prompt_id, Date.now())
  return { runId: body.prompt_id }
}

export interface RunStatus {
  state: 'waiting' | 'done' | 'failed'
  error?: string
  running?: boolean
  createdAt?: number
  startedAt?: number
  outputs?: Array<OutputFile & { node: string; kind: OutputKind }>
  text?: Record<string, string[]>
}

const submittedRuns = new Map<string, number>()

async function runWithoutHistory(runId: string): Promise<RunStatus> {
  const res = await cloudFetch(`/jobs/${runId}`)
  const answer = jobsAnswer(res.status, inJobGrace(submittedRuns, runId, Date.now()))
  if (answer !== 'read') {
    if (answer === 'refused') return { state: 'failed', error: (await failure(res)).message }
    await res.body?.cancel().catch(() => {})
    return answer === 'wait' ? { state: 'waiting' } : { state: 'failed', error: answer.error }
  }
  submittedRuns.delete(runId)
  const rec = (await res.json()) as {
    status?: string
    outputs_count?: number
    create_time?: number
    execution_start_time?: number
    execution_error?: { exception_message?: string }
  }
  if (rec.status === 'completed' && !rec.outputs_count)
    return { state: 'done', outputs: [], text: {} }
  if (rec.status === 'failed' || rec.status === 'cancelled') {
    return {
      state: 'failed',
      error:
        readable(rec.execution_error?.exception_message) ?? `The run ${rec.status} on Comfy Cloud.`
    }
  }
  return {
    state: 'waiting',
    running: rec.status === 'in_progress',
    createdAt: typeof rec.create_time === 'number' ? rec.create_time : undefined,
    startedAt: typeof rec.execution_start_time === 'number' ? rec.execution_start_time : undefined
  }
}

async function getRun(runId: unknown): Promise<RunStatus> {
  if (!isRunId(runId)) throw new Error('Unknown run.')
  const res = await cloudFetch(`/history_v2/${runId}`)
  if (res.status === 429) return { state: 'waiting' }
  if (res.status === 404) return runWithoutHistory(runId)
  if (!res.ok) throw await failure(res)
  const body = (await res.json()) as Record<string, HistoryEntry | undefined>
  const entry = body[runId]
  if (!entry) return { state: 'waiting' }
  submittedRuns.delete(runId)
  const status = entry.status ?? {}
  if (status.status_str === 'error') {
    const msg = status.messages?.find((m) => m[0] === 'execution_error')?.[1] as
      | { exception_message?: string }
      | undefined
    return {
      state: 'failed',
      error: readable(msg?.exception_message) ?? 'The run failed on Comfy Cloud.'
    }
  }
  if (!status.completed) return { state: 'waiting' }
  const { files, text } = collectOutputs(entry.outputs)
  return { state: 'done', outputs: files, text }
}

async function cancelRun(runId: unknown): Promise<{ ok: boolean; status: number }> {
  if (!isRunId(runId)) throw new Error('Unknown run.')
  const res = await cloudFetch(`/jobs/${runId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  })
  await res.body?.cancel().catch(() => {})
  return { ok: res.ok, status: res.status }
}

interface HistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: Array<[string, unknown]> }
  outputs?: unknown
}

async function appsRoot(): Promise<string> {
  const root = path.join(settings.get('outputDir'), 'apps')
  await fsp.mkdir(root, { recursive: true })
  return fsp.realpath(root)
}

async function saveResult(
  app: unknown,
  label: unknown,
  ext: string,
  write: (file: string) => Promise<void>
): Promise<string> {
  const slug = cleanSaveName(app)
  const name = cleanSaveName(label)
  if (!slug || !name) throw new Error('Name a result with letters, digits, dashes and spaces only.')
  const dir = path.join(await appsRoot(), slug)
  await fsp.mkdir(dir, { recursive: true })
  const base = savedFileName(name, ext)
  for (let n = 1; ; n++) {
    const file = path.join(dir, n === 1 ? base : base.replace(/(\.[a-z0-9]+)$/, ` ${n}$1`))
    try {
      await write(file)
      return file
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || n > 50) throw err
    }
  }
}

async function savedPath(file: unknown): Promise<string> {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Unknown file.')
  const real = await fsp.realpath(file).catch(() => null)
  if (!real || !isInside(real, await appsRoot(), path.sep)) throw new Error('Unknown file.')
  return real
}

async function getOutput(
  file: unknown,
  save?: unknown
): Promise<{ type: string; bytes: Uint8Array; path?: string }> {
  const f = toOutputFile(file)
  if (!f) throw new Error('Unknown output.')
  const ext = saveExt(f.filename.split('.').pop())
  if (save !== undefined && !ext) throw new Error('Apps cannot save that kind of file.')
  const query = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type })
  const view = `/view?${query}`
  if (save === undefined || !ext) {
    return cloudDownload(view, async (res, alive) => {
      const bytes = await readCapped(res, MAX_RESULT_BYTES, alive)
      if (!bytes) throw new Error('That result is larger than 100 MB, so Apps cannot show it.')
      return { type: contentType(res), bytes }
    })
  }
  const s = (save ?? {}) as { app?: unknown; label?: unknown }
  const saved = await cloudDownload(view, async (res, alive) => ({
    type: contentType(res),
    path: await saveResult(s.app, s.label, ext, async (file) => {
      if ((await streamToFile(res.body, file, MAX_SAVE_BYTES, alive)) === null)
        throw new Error('That result is larger than 2 GB, so Apps cannot save it.')
    })
  }))
  if ((await fsp.stat(saved.path)).size > MAX_RESULT_BYTES) {
    throw new Error(`Saved to ${saved.path}. It is larger than 100 MB, so Apps cannot show it.`)
  }
  return { ...saved, bytes: new Uint8Array(await fsp.readFile(saved.path)) }
}

function contentType(res: Response): string {
  return res.headers.get('content-type') ?? 'application/octet-stream'
}

async function saveFile(
  bytes: unknown,
  app: unknown,
  label: unknown,
  ext: unknown
): Promise<{ path: string }> {
  const e = saveExt(ext)
  if (!(bytes instanceof Uint8Array) || !e) throw new Error('Apps cannot save that file.')
  if (bytes.byteLength > MAX_RESULT_BYTES) throw new Error('Apps can save files up to 100 MB here.')
  const write = (file: string) => fsp.writeFile(file, bytes, { flag: 'wx' })
  return { path: await saveResult(app, label, e, write) }
}

async function readSaved(file: unknown): Promise<Uint8Array> {
  const real = await savedPath(file)
  if ((await fsp.stat(real)).size > MAX_RESULT_BYTES)
    throw new Error('That file is larger than 100 MB, so Apps cannot open it.')
  return new Uint8Array(await fsp.readFile(real))
}

async function saveVersions(app: unknown, bytes: unknown): Promise<void> {
  const slug = cleanSaveName(app)
  if (!slug || !isVersionsIndex(bytes)) throw new Error('Apps cannot save that list.')
  const dir = path.join(await appsRoot(), slug)
  await fsp.mkdir(dir, { recursive: true })
  const file = path.join(dir, VERSIONS_FILE)
  const tmp = `${file}.${randomUUID()}.tmp`
  await fsp.writeFile(tmp, bytes)
  await fsp.rename(tmp, file).catch(async (err: unknown) => {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    throw err
  })
}

async function readVersions(app: unknown): Promise<Uint8Array | null> {
  const slug = cleanSaveName(app)
  if (!slug) throw new Error('Unknown app.')
  const bytes = await fsp
    .readFile(path.join(await appsRoot(), slug, VERSIONS_FILE))
    .catch(() => null)
  return bytes ? new Uint8Array(bytes) : null
}

let priceBadges: { at: number; badges: Promise<Map<string, unknown>> } | null = null

async function readPriceBadges(): Promise<Map<string, unknown>> {
  const res = await cloudFetchRetrying('/object_info')
  if (!res.ok) throw await failure(res)
  const info = (await res.json()) as Record<string, { price_badge?: unknown } | undefined>
  const badges = new Map<string, unknown>()
  for (const [name, node] of Object.entries(info))
    if (node?.price_badge) badges.set(name, node.price_badge)
  return badges
}

async function getNodePrice(node: unknown): Promise<unknown> {
  if (typeof node !== 'string' || !/^\w{1,80}$/.test(node)) throw new Error('Unknown node.')
  if (!priceBadges || Date.now() - priceBadges.at > 60 * 60 * 1000) {
    const badges = readPriceBadges()
    priceBadges = { at: Date.now(), badges }
    badges.catch(() => (priceBadges = null))
  }
  return (await priceBadges.badges).get(node) ?? null
}

async function showInFolder(file: unknown): Promise<void> {
  shell.showItemInFolder(await savedPath(file))
}

async function uploadImage(bytes: unknown, name: unknown): Promise<{ name: string }> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error('Pick a file under 50 MB.')
  }
  const res = await cloudFetch('/upload/image', { method: 'POST', body: uploadForm(bytes, name) })
  if (!res.ok) throw await failure(res)
  const body = (await res.json()) as { name?: string }
  if (typeof body.name !== 'string') throw new Error('Comfy Cloud did not keep the file.')
  return { name: body.name }
}

function handleFromApps<A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!fromAppsPage(event)) throw new Error('Not allowed.')
    return fn(...(args as A))
  })
}

function handleFromAppsPage<A, R>(
  channel: string,
  fn: (arg: A, page: number) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (event, arg) => {
    if (!fromAppsPage(event)) throw new Error('Not allowed.')
    return fn(arg as A, event.sender.id)
  })
}

function appsPages(): WebContents[] {
  return [...views.values()]
    .map((v) => v.webContents)
    .filter((wc) => !wc.isDestroyed() && isAppsFrameUrl(wc.getURL(), APPS_ORIGIN))
}

export function registerAppsIpc(): void {
  ipcMain.on('comfy-apps:show', showApps)
  ipcMain.on('comfy-apps:hide', hideApps)
  initLocalComfy(appsPages)

  handleFromApps('comfy-apps:get-auth-state', authState)
  handleFromApps('comfy-apps:sign-in', async () => {
    await signInToCloud()
    return authState()
  })
  handleFromApps('comfy-apps:run', run)
  handleFromApps('comfy-apps:get-run', getRun)
  handleFromApps('comfy-apps:cancel-run', cancelRun)
  handleFromApps('comfy-apps:get-output', getOutput)
  handleFromApps('comfy-apps:upload-image', uploadImage)
  handleFromApps('comfy-apps:save-file', saveFile)
  handleFromApps('comfy-apps:read-saved', readSaved)
  handleFromApps('comfy-apps:show-in-folder', showInFolder)
  handleFromApps('comfy-apps:save-versions', saveVersions)
  handleFromApps('comfy-apps:read-versions', readVersions)
  handleFromApps('comfy-apps:get-node-price', getNodePrice)
  handleFromApps('comfy-apps:get-local', getLocal)
  handleFromApps('comfy-apps:start-local', startLocal)
  handleFromApps('comfy-apps:cancel-setup', cancelSetup)
  handleFromApps('comfy-apps:local-builds', localBuilds)
  handleFromAppsPage('comfy-apps:local-fetch', localFetch)
  handleFromApps('comfy-apps:local-download', localDownload)
  handleFromApps('comfy-apps:open-in-comfy', openInComfy)
}
