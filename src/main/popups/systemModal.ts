import { dialog, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { TITLEBAR_HEIGHT } from '../lib/titleBarOverlay'
import { EmbeddedPopupView } from './embeddedPopupView'

type SystemModalConfirmStyle = 'primary' | 'danger'
type SystemModalSecondaryStyle = 'primary' | 'danger' | 'default'

export interface SystemModalDetailGroup {
  label: string
  items: string[]
}

export interface SystemModalSpec {
  id: string
  title: string
  message: string
  details?: SystemModalDetailGroup[]
  confirmLabel: string
  cancelLabel: string
  confirmStyle?: SystemModalConfirmStyle
  secondaryLabel?: string
  secondaryStyle?: SystemModalSecondaryStyle
  theme: { bg: string; text: string }
}

type SystemModalAction = 'confirm' | 'cancel' | 'secondary'

export type SystemModalCallback = (action: SystemModalAction) => void

export interface SystemModalEntry {
  view: EmbeddedPopupView
  currentSpec: SystemModalSpec | null
  currentCallback: SystemModalCallback | null
  pendingSpec: { spec: SystemModalSpec; callback: SystemModalCallback } | null
  nativeRequest: { callback: SystemModalCallback; abort: AbortController } | null
}

const systemModalsByParent = new Map<number, SystemModalEntry>()
const systemModalsByWebContents = new Map<number, SystemModalEntry>()

function cancelEntry(entry: SystemModalEntry): void {
  const current = entry.currentCallback
  const pending = entry.pendingSpec?.callback
  const native = entry.nativeRequest
  entry.currentSpec = null
  entry.currentCallback = null
  entry.pendingSpec = null
  entry.nativeRequest = null
  native?.abort.abort()
  try {
    current?.('cancel')
  } catch {}
  try {
    pending?.('cancel')
  } catch {}
  try {
    native?.callback('cancel')
  } catch {}
}

function nativeDialogActions(spec: SystemModalSpec): SystemModalAction[] {
  return spec.secondaryLabel ? ['confirm', 'secondary', 'cancel'] : ['confirm', 'cancel']
}

function nativeDialogDetail(spec: SystemModalSpec): string {
  const groups = (spec.details ?? []).map((group) =>
    [group.label, ...group.items.map((item) => `• ${item}`)].join('\n')
  )
  return [spec.message, ...groups].filter((part) => part.length > 0).join('\n\n')
}

async function askWithNativeDialog(
  parent: BrowserWindow,
  spec: SystemModalSpec,
  signal: AbortSignal
): Promise<SystemModalAction> {
  const actions = nativeDialogActions(spec)
  const labels: Record<SystemModalAction, string> = {
    confirm: spec.confirmLabel,
    secondary: spec.secondaryLabel ?? '',
    cancel: spec.cancelLabel
  }
  try {
    const { response } = await dialog.showMessageBox(parent, {
      type: 'question',
      title: spec.title,
      message: spec.title,
      detail: nativeDialogDetail(spec),
      buttons: actions.map((action) => labels[action]),
      defaultId: 0,
      cancelId: actions.length - 1,
      noLink: true,
      signal
    })
    return actions[response] ?? 'cancel'
  } catch {
    return 'cancel'
  }
}

function answerWithNativeDialog(entry: SystemModalEntry): void {
  const spec = entry.currentSpec ?? entry.pendingSpec?.spec
  const callback = entry.currentCallback ?? entry.pendingSpec?.callback
  entry.currentSpec = null
  entry.currentCallback = null
  entry.pendingSpec = null
  entry.view.cancelPendingShow()
  entry.view.hide()
  if (!spec || !callback) return
  const parent = entry.view.parentWindow
  const request = { callback, abort: new AbortController() }
  entry.nativeRequest = request
  const answer: Promise<SystemModalAction> = parent.isDestroyed()
    ? Promise.resolve('cancel')
    : askWithNativeDialog(parent, spec, request.abort.signal)
  void answer.then((action) => {
    if (entry.nativeRequest !== request) return
    entry.nativeRequest = null
    try {
      callback(action)
    } catch {}
  })
}

export function ensureSystemModal(parent: BrowserWindow): SystemModalEntry {
  const existing = systemModalsByParent.get(parent.id)
  if (existing && !existing.view.isDestroyed()) return existing

  let layoutBelowTitleBar: () => void = () => {}
  const detachResizeListener = (): void => {
    if (!parent.isDestroyed()) parent.removeListener('resize', layoutBelowTitleBar)
  }

  const view = new EmbeddedPopupView({
    parent,
    htmlName: 'comfySystemModal',
    preloadName: 'comfySystemModalPreload.js',
    initialBounds: { x: 0, y: 0, width: 1, height: 1 },
    onParentClosed: () => {
      detachResizeListener()
      const cur = systemModalsByParent.get(parent.id)
      if (cur && cur.view === view) cancelEntry(cur)
      systemModalsByParent.delete(parent.id)
      systemModalsByWebContents.delete(view.popupWebContentsId)
    },
    onDestroyed: () => {
      detachResizeListener()
      const cur = systemModalsByParent.get(parent.id)
      if (cur && cur.view === view) {
        cancelEntry(cur)
        systemModalsByParent.delete(parent.id)
      }
      systemModalsByWebContents.delete(view.popupWebContentsId)
    }
  })
  const entry: SystemModalEntry = {
    view,
    currentSpec: null,
    currentCallback: null,
    pendingSpec: null,
    nativeRequest: null
  }
  systemModalsByParent.set(view.parentWindowId, entry)
  systemModalsByWebContents.set(view.popupWebContentsId, entry)
  view.popup.webContents.on('render-process-gone', () => answerWithNativeDialog(entry))

  layoutBelowTitleBar = (): void => {
    if (view.popup.webContents.isDestroyed() || parent.isDestroyed()) return
    const b = parent.getContentBounds()
    const y = TITLEBAR_HEIGHT + 1
    const h = Math.max(1, b.height - y)
    view.popup.setBounds({ x: 0, y, width: b.width, height: h })
  }
  layoutBelowTitleBar()
  parent.on('resize', layoutBelowTitleBar)

  return entry
}

function showSystemModalNow(entry: SystemModalEntry): void {
  if (entry.view.isDestroyed()) return
  const b = entry.view.parentWindow.getContentBounds()
  const y = TITLEBAR_HEIGHT + 1
  const h = Math.max(1, b.height - y)
  entry.view.popup.setBounds({ x: 0, y, width: b.width, height: h })
  entry.view.showOnTop({ focus: true })
}

export interface OpenSystemModalOpts {
  parent: BrowserWindow
  spec: Omit<SystemModalSpec, 'id'> & { id?: string }
  callback?: SystemModalCallback
}

export function openSystemModal(opts: OpenSystemModalOpts): string {
  const entry = ensureSystemModal(opts.parent)
  cancelEntry(entry)
  const id = opts.spec.id ?? `sysmodal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const spec: SystemModalSpec = { ...opts.spec, id }
  const callback: SystemModalCallback = opts.callback ?? (() => {})

  if (entry.view.popup.webContents.isCrashed()) {
    entry.currentSpec = spec
    entry.currentCallback = callback
    answerWithNativeDialog(entry)
    return id
  }

  if (!entry.view.rendererReady) {
    entry.pendingSpec = { spec, callback }
    return id
  }

  entry.currentSpec = spec
  entry.currentCallback = callback
  if (!entry.view.popup.webContents.isDestroyed()) {
    entry.view.popup.webContents.send('comfy-systemmodal:set-modal', spec)
  }
  entry.view.scheduleShowFallback(200, () => showSystemModalNow(entry))
  return id
}

function openSystemModalResolving<T>(
  opts: OpenSystemModalOpts,
  map: (action: SystemModalAction) => T
): Promise<T> {
  return new Promise((resolve) => {
    openSystemModal({
      parent: opts.parent,
      spec: opts.spec,
      callback: (action) => {
        if (opts.callback) {
          try {
            opts.callback(action)
          } catch {}
        }
        resolve(map(action))
      }
    })
  })
}

export function openSystemModalAsync(opts: OpenSystemModalOpts): Promise<boolean> {
  return openSystemModalResolving(opts, (action) => action === 'confirm')
}

export function registerSystemModalIpc(): void {
  ipcMain.on('comfy-systemmodal:ready', (event) => {
    const entry = systemModalsByWebContents.get(event.sender.id)
    if (!entry) return
    entry.view.rendererReady = true
    if (entry.pendingSpec) {
      const { spec, callback } = entry.pendingSpec
      entry.pendingSpec = null
      entry.currentSpec = spec
      entry.currentCallback = callback
      if (!entry.view.popup.webContents.isDestroyed()) {
        entry.view.popup.webContents.send('comfy-systemmodal:set-modal', spec)
      }
      entry.view.scheduleShowFallback(200, () => showSystemModalNow(entry))
    }
  })

  ipcMain.on('comfy-systemmodal:rendered', (event) => {
    const entry = systemModalsByWebContents.get(event.sender.id)
    if (!entry || !entry.currentSpec) return
    showSystemModalNow(entry)
  })

  ipcMain.on('comfy-systemmodal:render-failed', (event) => {
    const entry = systemModalsByWebContents.get(event.sender.id)
    if (!entry) return
    answerWithNativeDialog(entry)
  })

  ipcMain.on(
    'comfy-systemmodal:action',
    (event, payload: { modalId?: unknown; action?: unknown }) => {
      const entry = systemModalsByWebContents.get(event.sender.id)
      if (!entry) return
      const spec = entry.currentSpec
      const cb = entry.currentCallback
      if (!spec || !cb) return
      if (payload?.modalId !== spec.id) return
      const action = payload?.action
      if (action !== 'confirm' && action !== 'cancel' && action !== 'secondary') return
      entry.currentSpec = null
      entry.currentCallback = null
      entry.view.hide({ focusParent: true })
      try {
        cb(action)
      } catch {}
    }
  )
}
