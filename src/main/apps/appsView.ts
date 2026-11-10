/**
 * The sidebar's Apps section: a page we host, shown inside the dashboard
 * window, plus the small bridge that page uses to run on Comfy Cloud.
 *
 * The page never receives the Cloud token. It asks main to submit a workflow,
 * read a run's status, fetch an output, or upload an input file; main checks
 * the asking frame is on the apps origin and attaches the token itself.
 *
 * Every result the page fetches is also written to Desktop's output folder
 * (the `outputDir` setting) under `apps/<app>/`, named by main from the app
 * slug and a short label; the page never picks a path.
 *
 * The page can also run on the person's own ComfyUI that Desktop runs here
 * (localComfy.ts), behind the same frame check.
 */
import { ipcMain, shell, WebContentsView } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
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
  isAppsFrameUrl,
  isInside,
  isRunId,
  isVersionsIndex,
  isWorkflow,
  MAX_UPLOAD_BYTES,
  type OutputFile,
  readable,
  type OutputKind,
  saveExt,
  savedFileName,
  toOutputFile,
  uploadForm,
  VERSIONS_FILE
} from './guards'
import {
  getLocal,
  initLocalComfy,
  localDownload,
  localFetch,
  startLocal,
  syncLocalSocket
} from './localComfy'

const APPS_URL = appsUrl()
const APPS_ORIGIN = appsOrigin(APPS_URL)
const APPS_PARTITION = 'persist:comfy-apps'

/** One apps view per dashboard window, keyed by the window's registry key. */
const views = new Map<number, WebContentsView>()

export interface AppsRect {
  x: number
  y: number
  width: number
  height: number
}

export type AppsAuthState = { signedIn: false } | { signedIn: true; email?: string }

function openOutside(url: string): void {
  if (url.startsWith('https://')) void shell.openExternal(url)
}

function createAppsView(): WebContentsView {
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
  // The view stays on the apps origin; every other link opens in the browser.
  wc.on('will-navigate', (event, url) => {
    if (isAppsFrameUrl(url, APPS_ORIGIN)) return
    event.preventDefault()
    openOutside(url)
  })
  wc.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  void wc.loadURL(APPS_URL)
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
  if (!found || !APPS_ORIGIN) return
  const [key, entry] = found
  const r = rect as Partial<AppsRect> | null
  if (!r || ![r.x, r.y, r.width, r.height].every((n) => typeof n === 'number' && isFinite(n)))
    return
  let view = views.get(key)
  if (!view || view.webContents.isDestroyed()) {
    view = createAppsView()
    views.set(key, view)
    entry.window.once('closed', () => {
      views.delete(key)
      if (!view!.webContents.isDestroyed()) view!.webContents.close()
      syncLocalSocket()
    })
  }
  // The panel reports the slot in its own coordinates; offset by where the panel sits.
  const panel = entry.panelView!.getBounds()
  view.setBounds({
    x: Math.round(panel.x + r.x!),
    y: Math.round(panel.y + r.y!),
    width: Math.round(r.width!),
    height: Math.round(r.height!)
  })
  // Re-adding moves the view above the panel, which can be re-added under it on relayout.
  entry.window.contentView.addChildView(view)
  view.setVisible(true)
}

function hideApps(event: IpcMainEvent): void {
  const found = entryForPanel(event.sender)
  if (!found) return
  views.get(found[0])?.setVisible(false)
}

/** Only the top frame of one of our apps views, currently on the apps origin. */
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

async function cloudFetch(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  const token = await getCloudSession().getAccessToken()
  if (!token) throw new Error('Sign in to Comfy to use apps.')
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return fetch(`${CLOUD_CONFIG.apiBase}${pathAndQuery}`, { ...init, headers })
}

async function failure(res: Response): Promise<Error> {
  if (res.status === 429) return new Error('Comfy Cloud is busy. Try again in a minute.')
  const body = await res.text().catch(() => '')
  const text = res.headers.get('content-type')?.includes('html') ? '' : `: ${body.slice(0, 300)}`
  return new Error(`Comfy Cloud answered ${res.status}${text}`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Cloud answers 429 under load; wait as asked (or a little longer each time) and ask again. */
async function cloudFetchRetrying(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await cloudFetch(pathAndQuery, init)
    if (res.status !== 429 || attempt === 4) return res
    const asked = Number(res.headers.get('retry-after'))
    await sleep(asked > 0 ? Math.min(asked, 30) * 1000 : 2000 * (attempt + 1))
  }
}

/**
 * Submit a workflow; resolves to the id Cloud gives the run. Partner nodes (Claude, Wan,
 * Seedance) read the person's sign-in from extra_data.auth_token_comfy_org; Cloud swaps it
 * for a fresh token of its own at submit (ingest `refreshAuthToken`), and only when one is
 * there. The token goes only to Cloud, as it does in the Authorization header.
 */
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
  // Cloud runs the nodes that pass its checks and drops the rest; an app's graph is all or nothing.
  const refused = Object.entries(body.node_errors ?? {})[0]
  if (refused) {
    const [node, e] = refused
    const why = e.errors?.[0]?.details || e.errors?.[0]?.message || 'refused'
    throw new Error(`Comfy Cloud would not run node ${node} (${e.class_type ?? 'unknown'}): ${why}`)
  }
  if (!isRunId(body.prompt_id)) throw new Error('Comfy Cloud did not start the run.')
  return { runId: body.prompt_id }
}

export interface RunStatus {
  state: 'waiting' | 'done' | 'failed'
  error?: string
  /** Every file the run saved: images, videos, GLBs, text files. */
  outputs?: Array<OutputFile & { node: string; kind: OutputKind }>
  /** Text a node showed (PreviewAny, SaveText), by node id. */
  text?: Record<string, string[]>
}

/**
 * No history record: still running, or a run Cloud finished with nothing to record (every
 * node cached gave `completed`, 0 outputs and a 404 history on 2026-11-04). Cloud's run record tells which.
 */
async function runWithoutHistory(runId: string): Promise<RunStatus> {
  const res = await cloudFetch(`/jobs/${runId}`)
  if (!res.ok) return { state: 'waiting' }
  const rec = (await res.json()) as {
    status?: string
    outputs_count?: number
    execution_error?: { exception_message?: string }
  }
  if (rec.status === 'completed' && !rec.outputs_count)
    return { state: 'done', outputs: [], text: {} }
  // A failed run can have no history record either (Seedance refusing its output, 2026-11-05);
  // the run record still carries the node's message.
  if (rec.status === 'failed' || rec.status === 'cancelled') {
    return {
      state: 'failed',
      error:
        readable(rec.execution_error?.exception_message) ?? `The run ${rec.status} on Comfy Cloud.`
    }
  }
  return { state: 'waiting' }
}

/** A run's state from its history record; no record yet means it is still waiting or running. */
async function getRun(runId: unknown): Promise<RunStatus> {
  if (!isRunId(runId)) throw new Error('Unknown run.')
  const res = await cloudFetch(`/history_v2/${runId}`)
  // 429: Cloud is busy; the page asks again on its next poll.
  if (res.status === 429) return { state: 'waiting' }
  if (res.status === 404) return runWithoutHistory(runId)
  if (!res.ok) throw await failure(res)
  const body = (await res.json()) as Record<string, HistoryEntry | undefined>
  const entry = body[runId]
  if (!entry) return { state: 'waiting' }
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

interface HistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: Array<[string, unknown]> }
  outputs?: unknown
}

// ---- results on disk: <outputDir>/apps/<app>/<date> <label>.<ext> ----

async function appsRoot(): Promise<string> {
  const root = path.join(settings.get('outputDir'), 'apps')
  await fsp.mkdir(root, { recursive: true })
  return fsp.realpath(root)
}

/** Write a result into the app's folder; never overwrites (a second file gets " 2"). */
async function saveResult(
  app: unknown,
  label: unknown,
  ext: string,
  bytes: Uint8Array
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
      await fsp.writeFile(file, bytes, { flag: 'wx' })
      return file
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || n > 50) throw err
    }
  }
}

/** A path the page got back from a save, checked to be a file under <outputDir>/apps. */
async function savedPath(file: unknown): Promise<string> {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Unknown file.')
  const real = await fsp.realpath(file).catch(() => null)
  if (!real || !isInside(real, await appsRoot(), path.sep)) throw new Error('Unknown file.')
  return real
}

/**
 * An output's bytes, also saved to the app's folder. Bytes cross IPC as a Uint8Array (an
 * 18 MB GLB as a base64 data URL would be 24 MB of string); the page makes a blob URL.
 */
async function getOutput(
  file: unknown,
  save: unknown
): Promise<{ type: string; bytes: Uint8Array; path: string }> {
  const f = toOutputFile(file)
  if (!f) throw new Error('Unknown output.')
  const s = (save ?? {}) as { app?: unknown; label?: unknown }
  const ext = saveExt(f.filename.split('.').pop())
  if (!ext) throw new Error('Apps cannot save that kind of file.')
  const query = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type })
  const res = await cloudFetchRetrying(`/view?${query}`)
  if (!res.ok) throw await failure(res)
  const bytes = new Uint8Array(await res.arrayBuffer())
  const type = res.headers.get('content-type') ?? 'application/octet-stream'
  return { type, bytes, path: await saveResult(s.app, s.label, ext, bytes) }
}

/** A result the page made itself (camera keys, the rendered shot), saved like an output. */
async function saveFile(
  bytes: unknown,
  app: unknown,
  label: unknown,
  ext: unknown
): Promise<{ path: string }> {
  const e = saveExt(ext)
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_UPLOAD_BYTES || !e) {
    throw new Error('Apps cannot save that file.')
  }
  return { path: await saveResult(app, label, e, bytes) }
}

/** A saved result's bytes, so the page keeps only an index and the file stays the copy. */
async function readSaved(file: unknown): Promise<Uint8Array> {
  return new Uint8Array(await fsp.readFile(await savedPath(file)))
}

/**
 * The app's versions index, kept next to its results as <outputDir>/apps/<app>/versions.json.
 * Main names the file; the page passes only the app slug. Written whole each time (a temp file
 * renamed over it, so a crash never leaves half a file).
 */
async function saveVersions(app: unknown, bytes: unknown): Promise<void> {
  const slug = cleanSaveName(app)
  if (!slug || !isVersionsIndex(bytes)) throw new Error('Apps cannot save that list.')
  const dir = path.join(await appsRoot(), slug)
  await fsp.mkdir(dir, { recursive: true })
  const file = path.join(dir, VERSIONS_FILE)
  await fsp.writeFile(`${file}.tmp`, bytes)
  await fsp.rename(`${file}.tmp`, file)
}

async function readVersions(app: unknown): Promise<Uint8Array | null> {
  const slug = cleanSaveName(app)
  if (!slug) throw new Error('Unknown app.')
  const bytes = await fsp
    .readFile(path.join(await appsRoot(), slug, VERSIONS_FILE))
    .catch(() => null)
  return bytes ? new Uint8Array(bytes) : null
}

/** A node's price_badge from Cloud's node list: what Cloud shows as its price. */
// Cloud answers only the whole /object_info (about 11 MB), not one node, so the price badges
// are read from it once an hour and kept.
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

/** Upload an input file (an image or a video); resolves to the name a loader node takes. */
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

/** The Apps views whose page is on the apps origin: the only ones that hear the local ComfyUI. */
function appsPages(): WebContents[] {
  return [...views.values()]
    .map((v) => v.webContents)
    .filter((wc) => !wc.isDestroyed() && isAppsFrameUrl(wc.getURL(), APPS_ORIGIN))
}

/** Wire the Apps view and bridge. Called once at app `whenReady`. */
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
  handleFromApps('comfy-apps:local-fetch', localFetch)
  handleFromApps('comfy-apps:local-download', localDownload)
}
