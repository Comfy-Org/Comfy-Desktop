import { createI18n } from 'vue-i18n'
import { en } from './i18nMessages'

export function createAppI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en },
    missingWarn: false,
    fallbackWarn: false
  })
}
