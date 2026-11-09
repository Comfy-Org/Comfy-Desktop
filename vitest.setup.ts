import { afterEach, beforeAll } from 'vitest'
import { config, enableAutoUnmount } from '@vue/test-utils'

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

async function installAppI18nAfterTestFileMocksRegister(): Promise<void> {
  const { createAppI18n } = await import('./src/renderer/src/lib/i18nFactory')
  config.global.plugins = [...(config.global.plugins ?? []), createAppI18n()]
}

beforeAll(installAppI18nAfterTestFileMocksRegister)

enableAutoUnmount(afterEach)
