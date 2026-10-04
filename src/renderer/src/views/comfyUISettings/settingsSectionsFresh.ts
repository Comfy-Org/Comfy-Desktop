import type { ComputedRef, InjectionKey } from 'vue'

/** Whether the settings view's painted sections belong to its current install. False while the
 *  previous install's sections are still shown after a switch, until the new ones land. */
export const SETTINGS_SECTIONS_FRESH: InjectionKey<ComputedRef<boolean>> =
  Symbol('settingsSectionsFresh')
