import { EventEmitter } from 'node:events'

// Only external state is faked. The coordinator, document IPC, body-mode
// calculation, native views, preloads and browser SDK remain production code.
const events = new EventEmitter()
const identities: {
  promise: Promise<{ userId: string; firebaseUid: string } | null>
  resolve: (identity: { userId: string; firebaseUid: string } | null) => void
}[] = []
let consent = true

export const _runningSessions = new Set(['fixture-install'])
export const _isStopping = (): boolean => false
export const getLocale = (): string => 'ja'
export const getCustomerIoUserId = (): string => 'local-firebase-user'
export const get = (key: string): boolean => key === 'firstUseCompleted' || consent
export const setConsent = (value: boolean): void => {
  consent = value
}
export const authChanged = (): void => {
  events.emit('auth')
}
export const getCloudSession = () => ({
  getUserIdentity() {
    const request = Promise.withResolvers<{ userId: string; firebaseUid: string } | null>()
    identities.push(request)
    events.emit('identity-request')
    return request.promise
  },
  onAuthChanged(callback: () => void) {
    events.on('auth', callback)
    return () => events.off('auth', callback)
  }
})

export async function waitForIdentity(index: number): Promise<void> {
  if (identities[index]) return
  await new Promise<void>((resolve) => {
    const requested = (): void => {
      if (!identities[index]) return
      events.off('identity-request', requested)
      resolve()
    }
    events.on('identity-request', requested)
  })
}

export async function resolveIdentity(index: number, firebaseUid: string): Promise<void> {
  const request = identities[index]
  if (!request) throw new Error(`Identity request ${index} has not started`)
  // A different canonical ID catches accidental use of identity.userId.
  request.resolve({ userId: 'canonical-account-id', firebaseUid })
  await request.promise
}
