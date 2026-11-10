import type * as VueI18n from 'vue-i18n'
import { appI18nOptions } from './i18nOptions'

export async function vueI18nWithAppMessages(
  importOriginal: <T>() => Promise<T>
): Promise<typeof VueI18n> {
  const actual = await importOriginal<typeof VueI18n>()
  const { global } = actual.createI18n(appI18nOptions)
  return { ...actual, useI18n: (() => global) as typeof actual.useI18n }
}
