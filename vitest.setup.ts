import { afterEach, beforeAll } from 'vitest'
import { userEvent } from 'vitest/browser'
import { config, enableAutoUnmount } from '@vue/test-utils'

async function installAppI18nAfterTestFileMocksRegister(): Promise<void> {
  const { createAppI18n } = await import('./src/renderer/src/lib/i18nFactory')
  config.global.plugins = [...(config.global.plugins ?? []), createAppI18n()]
}

async function parkCursorInTheCorner(): Promise<void> {
  const corner = document.createElement('div')
  corner.style.cssText = 'position: fixed; right: 0; bottom: 0; width: 4px; height: 4px'
  document.body.append(corner)
  await userEvent.hover(corner)
  corner.remove()
}

beforeAll(installAppI18nAfterTestFileMocksRegister)
beforeAll(parkCursorInTheCorner)

enableAutoUnmount(afterEach)

afterEach(() => {
  localStorage.clear()
})
