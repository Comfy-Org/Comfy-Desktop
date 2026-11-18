import { onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'

type Messages = Record<string, unknown>

export interface LocaleSource {
  getLocale(): Promise<string>
  getMessages(): Promise<Messages>
  subscribe?(cb: (payload: { locale: string; messages: Messages }) => void): () => void
}

export function useAppLocale(source: LocaleSource): { syncLocale: () => Promise<void> } {
  const { locale, mergeLocaleMessage } = useI18n({ useScope: 'global' })

  function apply(next: string, messages: Messages): void {
    mergeLocaleMessage(next, messages)
    locale.value = next
  }

  const unsubscribe = source.subscribe?.(({ locale: next, messages }) => apply(next, messages))
  onUnmounted(() => unsubscribe?.())

  async function syncLocale(): Promise<void> {
    const [activeLocale, messages] = await Promise.all([source.getLocale(), source.getMessages()])
    apply(activeLocale, messages)
  }

  return { syncLocale }
}

export function windowApiLocaleSource(): LocaleSource {
  const api = window.api as Partial<typeof window.api> | undefined
  return {
    getLocale: () => api?.getLocale?.() ?? Promise.resolve('en'),
    getMessages: () => api?.getLocaleMessages?.() ?? Promise.resolve({}),
    subscribe: (cb) => api?.onLocaleChanged?.(cb) ?? (() => {})
  }
}
