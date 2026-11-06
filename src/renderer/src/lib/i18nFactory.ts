import { createI18n } from 'vue-i18n'
import { appI18nOptions } from './i18nOptions'

export function createAppI18n() {
  return createI18n(appI18nOptions)
}
