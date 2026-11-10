import { en } from './i18nMessages'

export const appI18nOptions = {
  legacy: false as const,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en },
  missingWarn: false,
  fallbackWarn: false
}
