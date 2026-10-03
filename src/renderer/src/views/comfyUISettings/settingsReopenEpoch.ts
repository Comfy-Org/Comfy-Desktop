import type { InjectionKey, Ref } from 'vue'

/** Changes each time a host that stays mounted while hidden (the instance picker) is reopened. */
export const SETTINGS_REOPEN_EPOCH: InjectionKey<Readonly<Ref<number>>> =
  Symbol('settingsReopenEpoch')
