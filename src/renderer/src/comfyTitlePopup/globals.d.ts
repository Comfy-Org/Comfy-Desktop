import type { ComfyTitlePopupBridge } from '../../../preload/comfyTitlePopupPreload'
import type { PickerSettingsApi } from './pickerSettingsApiShim'

declare global {
  interface Window {
    api: PickerSettingsApi
    __comfyTitlePopup?: ComfyTitlePopupBridge
  }
}

export {}
