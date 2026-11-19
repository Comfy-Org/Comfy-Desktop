import { afterEach, beforeAll } from 'vitest'
import { config, enableAutoUnmount } from '@vue/test-utils'

async function installAppI18nAfterTestFileMocksRegister(): Promise<void> {
  const { createAppI18n } = await import('./src/renderer/src/lib/i18nFactory')
  config.global.plugins = [...(config.global.plugins ?? []), createAppI18n()]
}

beforeAll(installAppI18nAfterTestFileMocksRegister)

enableAutoUnmount(afterEach)

afterEach(() => {
  localStorage.clear()
})
