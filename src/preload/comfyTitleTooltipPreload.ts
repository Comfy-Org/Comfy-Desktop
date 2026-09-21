import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

/**
 * Title-tooltip popup bridge. Hover tooltips render in a transparent WebContentsView
 * so they escape the title-bar view's clip; macOS Chromium doesn't reliably surface
 * native `title` tooltips for unfocused sibling chrome views. The view is reused
 * across hovers, driven by `comfy-titletooltip:set-config` pushes.
 */
export interface TitleTooltipConfig {
  /** `'tooltip'` (default) for the hover bubble; `'coachmark'` for a sticky card. */
  variant?: 'tooltip' | 'coachmark'
  /** Which feature owns a coachmark card. Opaque here — main routes on it; the renderer
   *  only echoes the card's shape. */
  kind?: string
  text?: string
  title?: string
  body?: string
  dismissLabel?: string
  /** Secondary action beside dismiss, when the card has one (e.g. the beta activation
   *  notice's link to Settings). Absent means the card is dismiss-only. */
  actionLabel?: string
  theme: { bg: string; text: string; border: string; accent?: string }
  /** Echoed back in `notifyRendered` so main can discard stale render-acks. */
  configToken: string
}

export interface ComfyTitleTooltipBridge {
  /** Renderer is mounted; main flushes any config queued before ready. */
  ready(): void
  /** Renderer painted the latest config. Main waits for this before showing. */
  notifyRendered(payload: { width: number; height: number; configToken: string }): void
  onConfig(cb: (config: TitleTooltipConfig) => void): () => void
  /** Beak position, pushed after main has measured the card and settled its final (possibly
   *  clamped) bounds. Separate from the config push because it is only knowable then. */
  onBeak(cb: (payload: { beakFraction: number }) => void): () => void
  /** Coachmark dismiss button; no-op for the tooltip variant. `configToken` names the card
   *  the click landed on, so main can discard a click from a card it has since replaced. */
  dismissCoachmark(configToken: string): void
  /** Coachmark secondary action. Also retires the card — acting on it is acknowledging it. */
  actionCoachmark(configToken: string): void
}

function isTooltipConfig(value: unknown): value is TitleTooltipConfig {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<TitleTooltipConfig>
  if (typeof v.configToken !== 'string') return false
  if (!v.theme || typeof v.theme !== 'object') return false
  if (typeof v.theme.bg !== 'string') return false
  if (typeof v.theme.text !== 'string') return false
  if (typeof v.theme.border !== 'string') return false
  // Coachmark needs title/body; tooltip needs text. One channel serves both.
  if (v.variant === 'coachmark') {
    if (typeof v.title !== 'string' && typeof v.body !== 'string') return false
  } else if (typeof v.text !== 'string') {
    return false
  }
  return true
}

const bridge: ComfyTitleTooltipBridge = {
  ready: () => {
    ipcRenderer.send('comfy-titletooltip:ready')
  },
  notifyRendered: (payload) => {
    ipcRenderer.send('comfy-titletooltip:rendered', payload)
  },
  onConfig: (cb) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void => {
      if (isTooltipConfig(data)) cb(data)
    }
    ipcRenderer.on('comfy-titletooltip:set-config', handler)
    return () => ipcRenderer.removeListener('comfy-titletooltip:set-config', handler)
  },
  onBeak: (cb) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void => {
      const raw = (data as { beakFraction?: unknown } | undefined)?.beakFraction
      if (typeof raw === 'number' && Number.isFinite(raw)) cb({ beakFraction: raw })
    }
    ipcRenderer.on('comfy-titletooltip:set-beak', handler)
    return () => ipcRenderer.removeListener('comfy-titletooltip:set-beak', handler)
  },
  dismissCoachmark: (configToken) => {
    ipcRenderer.send('comfy-titlecoachmark:dismiss', { configToken })
  },
  actionCoachmark: (configToken) => {
    ipcRenderer.send('comfy-titlecoachmark:action', { configToken })
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('__comfyTitleTooltip', bridge)
} else {
  ;(globalThis as Record<string, unknown>).__comfyTitleTooltip = bridge
}
