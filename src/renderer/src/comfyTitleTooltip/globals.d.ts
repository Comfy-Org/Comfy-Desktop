import type { ComfyTitleTooltipBridge } from '../../../preload/comfyTitleTooltipPreload'

declare global {
  interface Window {
    __comfyTitleTooltip?: ComfyTitleTooltipBridge
  }
}

export {}
