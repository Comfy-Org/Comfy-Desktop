import { afterEach } from 'vitest'
import { config, enableAutoUnmount } from '@vue/test-utils'
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
      }
    }
  })
}

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

enableAutoUnmount(afterEach)
