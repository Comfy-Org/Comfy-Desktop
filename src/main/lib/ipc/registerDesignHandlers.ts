/**
 * Design prototype (src/renderer/src/design/landing), for the launcher
 * prototype's "Data: Mine":
 *
 * Builds (installs) open as tabs in the launcher window: each open build gets
 * its own ComfyUI view under the title bar; Home hides them to show the
 * launcher again. ComfyUI keeps running while its tab is open.
 *
 * And the user's real workflows per build:
 * - Comfy Cloud: the active workspace's saved workflows, from the Cloud
 *   ComfyUI API (`/api/userdata?dir=workflows`, as the frontend lists them),
 *   signed with the session token. The token never leaves main.
 * - Local installs: the JSON files in `<install>/ComfyUI/user/default/workflows`.
 */
import fs from 'fs'
import path from 'path'
import { ipcMain, shell, WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import * as installations from '../../installations'
import { handleFirebasePopup, isFirebaseAuthHandlerUrl } from '../../auth/firebaseBridge'
import { comfyWindows } from '../../host/registry'
import { expectedPartitionFor } from '../../host/partition'
import { TITLEBAR_HEIGHT } from '../titleBarOverlay'
import { _getPublicSessions } from './shared'
import { CLOUD_ISSUER } from '../../cloud'
import { getCloudSession } from '../../devplatform/session'

export interface DesignWorkflow {
  /** Path inside the workflows folder, e.g. `portraits/hero.json`. */
  path: string
  /** Epoch ms of the last save. */
  modified: number
  size: number
}

export type DesignWorkflowsResult =
  | { ok: true; workflows: DesignWorkflow[] }
  | { ok: false; reason: 'signed-out' | 'not-found' | 'error'; message?: string }

async function listLocal(installPath: string): Promise<DesignWorkflow[]> {
  const root = path.join(installPath, 'ComfyUI', 'user', 'default', 'workflows')
  if (!fs.existsSync(root)) return []
  const out: DesignWorkflow[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        const stat = await fs.promises.stat(full)
        out.push({
          path: path.relative(root, full),
          modified: stat.mtimeMs,
          size: stat.size
        })
      }
    }
  }
  await walk(root)
  return out
}

async function listCloud(): Promise<DesignWorkflowsResult> {
  const session = getCloudSession()
  if (!session.status().signedIn) return { ok: false, reason: 'signed-out' }
  const token = await session.getAccessToken()
  if (!token) return { ok: false, reason: 'signed-out' }
  const url = new URL('/api/userdata', CLOUD_ISSUER)
  url.search = new URLSearchParams({
    dir: 'workflows',
    recurse: 'true',
    split: 'false',
    full_info: 'true'
  }).toString()
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 404) return { ok: true, workflows: [] }
  if (!res.ok) return { ok: false, reason: 'error', message: `Cloud responded ${res.status}` }
  const rows = (await res.json()) as { path: string; modified?: number; size?: number }[]
  return {
    ok: true,
    workflows: rows
      .filter((r) => r.path.endsWith('.json'))
      .map((r) => ({
        path: r.path,
        // The API reports seconds or ms depending on the backend: normalise.
        modified: r.modified && r.modified < 1e12 ? r.modified * 1000 : (r.modified ?? 0),
        size: r.size ?? 0
      }))
  }
}

/** Build views per launcher window (window key), and which one shows. */
interface BuildTabs {
  views: Map<string, WebContentsView>
  active: string | null
}

const tabsByWindow = new Map<number, BuildTabs>()

/** The launcher window whose panel sent this. */
function windowOfPanel(sender: WebContents): { key: number; win: BrowserWindow } | null {
  for (const [key, entry] of comfyWindows)
    if (entry.panelView?.webContents.id === sender.id) return { key, win: entry.window }
  return null
}

function layout(win: BrowserWindow, tabs: BuildTabs): void {
  if (win.isDestroyed()) return
  const [width, height] = win.getContentSize() as [number, number]
  const top = TITLEBAR_HEIGHT + 1
  const body = { x: 0, y: top, width, height: Math.max(0, height - top) }
  for (const [id, view] of tabs.views) {
    const shown = id === tabs.active
    view.setBounds(shown ? body : { x: 0, y: top, width: 0, height: 0 })
    view.setVisible(shown)
  }
}

function tabsFor(key: number, win: BrowserWindow): BuildTabs {
  const tabs = tabsByWindow.get(key)
  if (tabs) return tabs
  const created: BuildTabs = { views: new Map(), active: null }
  tabsByWindow.set(key, created)
  win.on('resize', () => layout(win, created))
  win.on('closed', () => {
    for (const view of created.views.values()) view.webContents.close()
    tabsByWindow.delete(key)
  })
  return created
}

/** Where a running build's ComfyUI is served, or null when it isn't running. */
function runningUrl(installationId: string): string | null {
  const s = _getPublicSessions().find((x) => x.installationId === installationId)
  if (!s) return null
  if (typeof s.url === 'string' && s.url) return s.url
  return typeof s.port === 'number' ? `http://127.0.0.1:${s.port}` : null
}

export type DesignShowBuildResult =
  | { ok: true }
  | { ok: false; reason: 'not-running' | 'not-found' }

export function registerDesignHandlers(): void {
  // Show a build under the title bar (null = Home: hide them all). Creates
  // its view on first show; the build must be running (the renderer starts
  // it first).
  ipcMain.handle(
    'comfy-design:show-build',
    async (event, installationId: string | null): Promise<DesignShowBuildResult> => {
      const host = windowOfPanel(event.sender)
      if (!host) return { ok: false, reason: 'not-found' }
      const tabs = tabsFor(host.key, host.win)
      if (installationId && !tabs.views.has(installationId)) {
        const inst = await installations.get(installationId)
        if (!inst) return { ok: false, reason: 'not-found' }
        const url = runningUrl(installationId)
        if (!url) {
          // Not running yet: show the launcher (its tab says it's starting).
          tabs.active = null
          layout(host.win, tabs)
          return { ok: false, reason: 'not-running' }
        }
        const view = new WebContentsView({
          webPreferences: { partition: expectedPartitionFor(inst), sandbox: true }
        })
        const contents = view.webContents
        contents.setWindowOpenHandler(({ url: target }) => {
          // Cloud sign-in goes through the system browser, as in a build window.
          if (isFirebaseAuthHandlerUrl(target))
            void handleFirebasePopup(target, contents, { parentWindow: host.win })
          else void shell.openExternal(target)
          return { action: 'deny' }
        })
        // ⌘⇧H (Ctrl+Shift+H) goes Home from inside ComfyUI too.
        contents.on('before-input-event', (e, input) => {
          if (input.type !== 'keyDown' || !input.shift || input.key.toLowerCase() !== 'h') return
          if (!(input.meta || input.control) || event.sender.isDestroyed()) return
          e.preventDefault()
          event.sender.send('comfy-design:menu-pick', 'home')
        })
        host.win.contentView.addChildView(view)
        tabs.views.set(installationId, view)
        void view.webContents.loadURL(url)
      }
      tabs.active = installationId
      layout(host.win, tabs)
      return { ok: true }
    }
  )

  // Close a build's tab: its view goes. Stopping ComfyUI is the renderer's call.
  ipcMain.handle('comfy-design:close-build', (event, installationId: string): void => {
    const host = windowOfPanel(event.sender)
    const tabs = host && tabsByWindow.get(host.key)
    const view = tabs?.views.get(installationId)
    if (!host || !tabs || !view) return
    host.win.contentView.removeChildView(view)
    view.webContents.close()
    tabs.views.delete(installationId)
    if (tabs.active === installationId) tabs.active = null
    layout(host.win, tabs)
  })

  ipcMain.handle(
    'comfy-design:list-workflows',
    async (_event, installationId: string): Promise<DesignWorkflowsResult> => {
      try {
        const inst = await installations.get(installationId)
        if (!inst) return { ok: false, reason: 'not-found' }
        if (inst.sourceId === 'cloud') return await listCloud()
        if (!inst.installPath) return { ok: true, workflows: [] }
        return { ok: true, workflows: await listLocal(inst.installPath) }
      } catch (err) {
        return { ok: false, reason: 'error', message: (err as Error).message }
      }
    }
  )
}
