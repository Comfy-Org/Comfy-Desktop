import { config } from '@vue/test-utils'
import { createAppI18n } from './src/renderer/src/lib/i18nFactory'

const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
if (!localStorageDescriptor || 'get' in localStorageDescriptor) {
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length(): number {
        return storage.size
      },
      clear(): void {
        storage.clear()
      },
      getItem(key: string): string | null {
        return storage.get(key) ?? null
      },
      key(index: number): string | null {
        return Array.from(storage.keys())[index] ?? null
      },
      removeItem(key: string): void {
        storage.delete(key)
      },
      setItem(key: string, value: string): void {
        storage.set(key, String(value))
      },
    },
  })
}

/**
 * Global vue-i18n plugin for every component mount in unit tests.
 * Mirrors the per-renderer setup in `comfyTitleBar/main.ts`,
 * `comfyTitlePopup/main.ts`, etc. so components that call `useI18n()`
 * resolve keys identically in tests and at runtime — without each
 * test having to thread `global.plugins` through `mount()`.
 */
config.global.plugins = [...(config.global.plugins ?? []), createAppI18n()]
const duplicateI18nRegistration =
  /^\[Vue warn\]: (Component "(?:i18n-t|I18nT|i18n-n|I18nN|i18n-d|I18nD)"|Directive "t") has already been registered in target app\.$/
const missingI18nFixtureKey = /^\[intlify\] Not found '.+' key in 'en' locale messages\.$/
const originalConsoleWarn = console.warn.bind(console)

console.warn = (...args: unknown[]): void => {
  const first = typeof args[0] === 'string' ? args[0] : ''
  if (duplicateI18nRegistration.test(first)) return
  if (missingI18nFixtureKey.test(first)) return
  originalConsoleWarn(...args)
}
