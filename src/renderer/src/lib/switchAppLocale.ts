import { config } from '@vue/test-utils'
import type { I18n } from 'vue-i18n'
import zh from '@locales/zh.json'

type Messages = Record<string, unknown>
type AppI18n = I18n<Messages, Messages, Messages, string, false>

function appI18n(): AppI18n {
  const plugin = config.global.plugins.find(
    (candidate): candidate is AppI18n =>
      typeof candidate === 'object' && candidate !== null && 'global' in candidate
  )
  if (!plugin) throw new Error('The app i18n plugin is not installed in the test setup')
  return plugin
}

export function switchAppLocaleToChinese(): void {
  const i18n = appI18n()
  i18n.global.setLocaleMessage('zh', zh)
  i18n.global.locale.value = 'zh'
}

export function resetAppLocale(): void {
  appI18n().global.locale.value = 'en'
}
