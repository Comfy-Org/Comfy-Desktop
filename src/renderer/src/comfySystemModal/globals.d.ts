import type { ComfySystemModalBridge } from '../../../preload/comfySystemModalPreload'

declare global {
  interface Window {
    __comfySystemModal?: ComfySystemModalBridge
  }
}

export {}
