import {
  AnalyticsBrowser,
  InAppPlugin,
  type LegacySettings
} from '@customerio/cdp-analytics-browser'
import Gist from 'customerio-gist-web'
import type { CustomerIoSession } from '../../../shared/customerIo'
import type { MessagingClient } from './controller'

/** Retry network setup before constructing the document's one SDK instance. */
export function createMessagingClientLoader(openLink: (action: string) => void) {
  let initialization: Promise<MessagingClient> | undefined
  return async (session: CustomerIoSession, currentSession: () => CustomerIoSession | null) => {
    if (!initialization) {
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), 10_000)
      try {
        const response = await fetch(
          `https://cdp.customer.io/v1/projects/${encodeURIComponent(session.writeKey)}/settings`,
          { signal: abort.signal }
        )
        if (!response.ok) throw new Error('Customer.io settings are unavailable')
        const settings = (await response.json()) as LegacySettings
        // Retain this promise even on failure: a partially initialized SDK cannot
        // be discarded while its listeners, buffers, or plugins are still alive.
        initialization ??= initialize(session, currentSession, settings, openLink)
      } finally {
        clearTimeout(timer)
      }
    }
    return initialization
  }
}

async function initialize(
  session: CustomerIoSession,
  currentSession: () => CustomerIoSession | null,
  cdnSettings: LegacySettings,
  openLink: (action: string) => void
): Promise<MessagingClient> {
  const analytics = AnalyticsBrowser.load(
    { writeKey: session.writeKey, cdnSettings: { ...cdnSettings } },
    {
      user: { persist: false },
      group: { persist: false },
      retryQueue: false,
      disableClientPersistence: true,
      integrations: {
        All: false,
        'Customer.io Data Pipelines': true,
        // Register below with Desktop's lifecycle callbacks, even if the source
        // settings also enable automatic in-app initialization.
        'Customer.io In-App Plugin': { enabled: false }
      }
    }
  )
  // Await the loader itself: buffered method promises never reject if loading fails.
  await analytics
  await analytics.addSourceMiddleware(({ payload, next }) => {
    const current = currentSession()
    if (!current || payload.obj.userId !== current.userId) return
    if (payload.obj.type === 'page' && payload.obj.name !== current.page) return
    // A desktop file path or local workflow URL is not a useful campaign page.
    payload.obj.context = {
      ...payload.obj.context,
      page: {
        path: current.page,
        url: current.page,
        title: 'ComfyUI Desktop',
        referrer: '',
        search: ''
      }
    }
    next(payload)
  })
  // The SDK also writes this flag from visibilitychange. Keep Desktop's
  // consent/focus gate authoritative when Chromium changes visibility later.
  Object.defineProperty(Gist, 'isDocumentVisible', {
    configurable: true,
    get: () => currentSession() !== null && document.visibilityState !== 'hidden',
    set: () => {}
  })
  const plugin = InAppPlugin({
    siteId: session.siteId,
    anonymousInApp: false,
    _env: undefined,
    _logging: undefined,
    colorScheme: 'auto',
    events: (event) => {
      if (event.type !== 'in-app:message-action' || !currentSession()) return
      const detail = (event as CustomEvent<{ actionValue?: string }>).detail
      if (detail?.actionValue) openLink(detail.actionValue)
    }
  })
  const identify = plugin.identify!
  plugin.identify = (context) => {
    const current = currentSession()
    if (!current || context.event.userId !== current.userId) return context
    return identify(context)
  }
  // The vendor page hook starts a route change without awaiting it. Keep that
  // operation under the same owner as identify/reset, with a fresh session gate.
  plugin.page = async (context) => {
    const current = currentSession()
    if (current && context.event.userId === current.userId && context.event.name === current.page) {
      await Gist.setCurrentRoute(current.page)
    }
    return context
  }
  await analytics.register(plugin)
  let dismissal = Promise.resolve()
  return {
    identify: async (identity) => {
      if (!navigator.onLine) throw new Error('Customer.io is offline')
      Gist.setUserLocale(identity.locale)
      await analytics.identify(identity.userId, { locale: identity.locale })
    },
    page: async ({ page }) => {
      if (!navigator.onLine) throw new Error('Customer.io is offline')
      await analytics.page(page, {
        url: page,
        path: page,
        title: 'ComfyUI Desktop',
        search: '',
        referrer: ''
      })
    },
    reset: async () => {
      await dismissal
      await analytics.reset()
      await Gist.clearUserToken()
    },
    dismiss: () => {
      // Clear the queue token and SSE connection without waiting for an in-flight
      // analytics operation. Its old-identity events are also filtered above.
      const clearing = Gist.clearUserToken()
      const messages = [...Gist.currentMessages]
      for (const message of messages) {
        const element = document.getElementById(`gist-${message.instanceId}`)
        // Persistent-message dismissal waits for a view-log request. Remove its
        // modal backdrop synchronously so revoked messages cannot block input.
        element?.closest('#gist-overlay')?.remove()
        if (element) element.style.visibility = 'hidden'
      }
      dismissal = Promise.all([
        dismissal,
        clearing,
        ...messages.map((message) =>
          message.instanceId ? Gist.dismissMessage(message.instanceId) : Promise.resolve()
        )
      ]).then(
        () => {},
        () => {}
      )
    }
  }
}
