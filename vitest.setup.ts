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

enableAutoUnmount(afterEach)
