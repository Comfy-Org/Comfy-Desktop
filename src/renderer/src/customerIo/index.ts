import { AnalyticsBrowser, InAppPlugin } from '@customerio/cdp-analytics-browser'
import Gist from 'customerio-gist-web'
import type { CustomerIoSession } from '../../../shared/customerIo'
import { createMessagingController } from './controller'
import { setMessagingPage } from './environment'

const controller = createMessagingController(async (session, currentSession) => {
  const analytics = AnalyticsBrowser.load(
    { writeKey: session.writeKey },
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
  await analytics.register(
    InAppPlugin({
      siteId: session.siteId,
      anonymousInApp: false,
      _env: undefined,
      _logging: undefined,
      colorScheme: 'auto',
      events: (event) => {
        if (event.type !== 'in-app:message-action' || !currentSession()) return
        const detail = (event as CustomEvent<{ actionValue?: string }>).detail
        if (detail?.actionValue) messagingGlobal.__comfyCustomerIoOpenLink?.(detail.actionValue)
      }
    })
  )
  // The SDK also writes this flag from visibilitychange. Keep Desktop's
  // consent/focus gate authoritative when Chromium changes visibility later.
  Object.defineProperty(Gist, 'isDocumentVisible', {
    configurable: true,
    get: () => currentSession() !== null && document.visibilityState !== 'hidden',
    set: () => {}
  })
  let dismissal = Promise.resolve()
  return {
    identify: async (identity) => {
      Gist.setUserLocale(identity.locale)
      await analytics.identify(identity.userId, { locale: identity.locale })
    },
    page: async ({ page }) => {
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
})

const messagingGlobal = globalThis as typeof globalThis & {
  __comfyCustomerIo: { update: (session: CustomerIoSession | null) => Promise<void> }
  __comfyCustomerIoOpenLink?: (action: string) => boolean
}
let lastSession: CustomerIoSession | null = null
messagingGlobal.__comfyCustomerIo = {
  update(session) {
    lastSession = session
    setMessagingPage(session?.page ?? null)
    return controller.update(session)
  }
}
window.addEventListener('online', () => {
  void controller.update(lastSession)
})
