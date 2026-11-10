import type { CoachmarkBeakPayload } from '../types/ipc'
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

export interface TitleTooltipConfig {
  variant?: 'tooltip' | 'coachmark'
  kind?: string
  text?: string
  title?: string
  body?: string
  dismissLabel?: string
  actionLabel?: string
  theme: { bg: string; text: string; border: string; accent?: string }
  configToken: string
}

export interface ComfyTitleTooltipBridge {
  ready(): void
  notifyRendered(payload: { width: number; height: number; configToken: string }): void
  onConfig(cb: (config: TitleTooltipConfig) => void): () => void
  onBeak(cb: (payload: CoachmarkBeakPayload) => void): () => void
  dismissCoachmark(configToken: string): void
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
      const payload = data as { beakFraction?: unknown; cardCentreInView?: unknown } | undefined
      const raw = payload?.beakFraction
      const centre = payload?.cardCentreInView
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        cb({
          beakFraction: raw,
          cardCentreInView:
            typeof centre === 'number' && Number.isFinite(centre) && centre >= 0 ? centre : null
        })
      }
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
