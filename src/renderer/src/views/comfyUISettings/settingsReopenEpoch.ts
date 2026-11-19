import type { InjectionKey, Ref } from 'vue'

export const SETTINGS_REOPEN_EPOCH: InjectionKey<Readonly<Ref<number>>> =
  Symbol('settingsReopenEpoch')
