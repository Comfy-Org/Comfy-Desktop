import type { ComfyTitleBarBridge } from '../../../preload/comfyTitleBarPreload'

declare global {
  interface Window {
    __comfyTitleBar?: ComfyTitleBarBridge
  }
}

export {}
