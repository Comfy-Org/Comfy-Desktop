/**
 * The sidebar's Apps section: a page we host, shown inside the dashboard
 * window, plus the small bridge that page uses to run on Comfy Cloud.
 *
 * The page never receives the Cloud token. It asks main to submit a workflow,
 * read a run's status, fetch an output, or upload an input image; main checks
 * the asking frame is on the apps origin and attaches the token itself.
 */
import { ipcMain, shell, WebContentsView } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import path from 'path'

import { CLOUD_CONFIG } from '../cloud/config'
import { getCloudSession } from '../devplatform/session'
import { comfyWindows } from '../host/registry'
import { signInToCloud } from '../lib/ipc/registerDevPlatformHandlers'
import {
  appsOrigin,
  appsUrl,
  isAppsFrameUrl,
  isRunId,
  isWorkflow,
  MAX_UPLOAD_BYTES,
  safeUploadName,
  toOutputFile
} from './guards'

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

/** Submit a workflow; resolves to the id Cloud gives the run. */
async function run(workflow: unknown): Promise<{ runId: string }> {
  if (!isWorkflow(workflow)) throw new Error('That is not a workflow.')
  const res = await cloudFetch('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow })
  })
  if (!res.ok) throw await failure(res)
  const body = (await res.json()) as { prompt_id?: string; node_errors?: unknown }
  if (!isRunId(body.prompt_id)) throw new Error('Comfy Cloud did not start the run.')
  return { runId: body.prompt_id }
}

export interface RunStatus {
  state: 'waiting' | 'done' | 'failed'
  error?: string
  outputs?: Array<{ filename: string; subfolder: string; type: string }>
}

/** A run's state from its history record; no record yet means it is still waiting or running. */
async function getRun(runId: unknown): Promise<RunStatus> {
  if (!isRunId(runId)) throw new Error('Unknown run.')
  const res = await cloudFetch(`/history_v2/${runId}`)
  // 404: no record yet. 429: Cloud is busy; the page asks again on its next poll.
  if (res.status === 404 || res.status === 429) return { state: 'waiting' }
  if (!res.ok) throw await failure(res)
  const body = (await res.json()) as Record<string, HistoryEntry | undefined>
  const entry = body[runId]
  if (!entry) return { state: 'waiting' }
  const status = entry.status ?? {}
  if (status.status_str === 'error') {
    const msg = status.messages?.find((m) => m[0] === 'execution_error')?.[1] as
      | { exception_message?: string }
      | undefined
    return { state: 'failed', error: msg?.exception_message ?? 'The run failed on Comfy Cloud.' }
  }
  if (!status.completed) return { state: 'waiting' }
  const outputs = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? [])
  return { state: 'done', outputs }
}

interface HistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: Array<[string, unknown]> }
  outputs?: Record<
    string,
    { images?: Array<{ filename: string; subfolder: string; type: string }> }
  >
}

/** An output image as a data URL, so the page needs no Cloud credentials to show it. */
async function getOutput(file: unknown): Promise<string> {
  const f = toOutputFile(file)
  if (!f) throw new Error('Unknown output.')
  const query = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type })
  const res = await cloudFetchRetrying(`/view?${query}`)
  if (!res.ok) throw await failure(res)
  const bytes = Buffer.from(await res.arrayBuffer())
  const type = res.headers.get('content-type') ?? 'image/png'
  return `data:${type};base64,${bytes.toString('base64')}`
}

/** Upload an input image; resolves to the name a LoadImage node takes. */
async function uploadImage(bytes: unknown, name: unknown): Promise<{ name: string }> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error('Pick an image under 20 MB.')
  }
  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(bytes)]), safeUploadName(name))
  form.append('overwrite', 'true')
  const res = await cloudFetch('/upload/image', { method: 'POST', body: form })
  if (!res.ok) throw await failure(res)
  const body = (await res.json()) as { name?: string }
  if (typeof body.name !== 'string') throw new Error('Comfy Cloud did not keep the image.')
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

/** Wire the Apps view and bridge. Called once at app `whenReady`. */
export function registerAppsIpc(): void {
  ipcMain.on('comfy-apps:show', showApps)
  ipcMain.on('comfy-apps:hide', hideApps)

  handleFromApps('comfy-apps:get-auth-state', authState)
  handleFromApps('comfy-apps:sign-in', async () => {
    await signInToCloud()
    return authState()
  })
  handleFromApps('comfy-apps:run', run)
  handleFromApps('comfy-apps:get-run', getRun)
  handleFromApps('comfy-apps:get-output', getOutput)
  handleFromApps('comfy-apps:upload-image', uploadImage)
}
