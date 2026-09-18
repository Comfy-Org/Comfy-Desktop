import type { CustomerIoSession } from '../../../shared/customerIo'
import { createMessagingController } from './controller'
import { createMessagingClientLoader } from './adapter'
import { setMessagingPage } from './environment'

const controller = createMessagingController(
  createMessagingClientLoader((action) => messagingGlobal.__comfyCustomerIoOpenLink?.(action))
)

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
