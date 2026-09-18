import type { CustomerIoPage } from '../../../shared/customerIo'

let page: CustomerIoPage | null = null

export function setMessagingPage(value: CustomerIoPage | null): void {
  page = value
}

/**
 * SDK-only browser environment, injected at bundle time. The SDK reads URL
 * identity parameters before middleware and enriches events again afterward.
 * It must never observe the host page's URL or navigate the workflow away.
 */
export const sdkLocation = {
  get href(): string {
    return `https://desktop.invalid/${page ?? 'inactive'}`
  },
  set href(_value: string) {
    // Message actions already pass through the validated main-process bridge.
  },
  get pathname(): string {
    return `/${page ?? 'inactive'}`
  },
  origin: 'https://desktop.invalid',
  protocol: 'https:',
  host: 'desktop.invalid',
  hostname: 'desktop.invalid',
  port: '',
  search: '',
  hash: '',
  assign(_value: string): void {},
  replace(_value: string): void {},
  reload(): void {},
  toString(): string {
    return this.href
  }
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.get(String(key)) ?? null
    },
    key(index) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key) {
      values.delete(String(key))
    },
    setItem(key, value) {
      values.set(String(key), String(value))
    }
  }
}

export const sdkLocalStorage = memoryStorage()
export const sdkSessionStorage = memoryStorage()
