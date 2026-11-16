import type { LocaleSource } from './useAppLocale'

export function windowApiLocaleSource(): LocaleSource {
  const api = window.api as Partial<typeof window.api> | undefined
  return {
    getLocale: () => api?.getLocale?.() ?? Promise.resolve('en'),
    getMessages: () => api?.getLocaleMessages?.() ?? Promise.resolve({}),
    subscribe: (cb) => api?.onLocaleChanged?.(cb) ?? (() => {})
  }
}
