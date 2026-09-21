import type { CustomerIoSession } from '../../../shared/customerIo'

export interface MessagingClient {
  identify(session: CustomerIoSession): Promise<void>
  page(): Promise<void>
  reset(): Promise<void>
  dismiss(): void
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Customer.io operation timed out')), 10_000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Serializes identity changes while rejecting work queued for an obsolete session. */
export function createMessagingController(
  load: (
    session: CustomerIoSession,
    currentSession: () => CustomerIoSession | null
  ) => Promise<MessagingClient>,
  reportError: (error: unknown) => void = (error) =>
    console.warn('Desktop messaging is unavailable', error)
): { update: (session: CustomerIoSession | null) => Promise<void> } {
  let desired: CustomerIoSession | null = null
  let client: MessagingClient | null = null
  let identified: CustomerIoSession | null = null
  let version = 0
  let queue = Promise.resolve()
  function update(session: CustomerIoSession | null): Promise<void> {
    if (JSON.stringify(desired) === JSON.stringify(session)) return queue
    desired = session
    const revision = ++version
    // Hide a previous user's message immediately, even if an SDK operation is pending.
    if (!session || identified?.userId !== session.userId) client?.dismiss()
    queue = queue
      .then(async () => {
        if (revision !== version) return
        if (!session) {
          if (client) await bounded(client.reset())
          identified = null
          return
        }
        client ??= await bounded(load(session, () => desired))
        if (revision !== version) return
        if (identified?.userId !== session.userId) {
          await bounded(client.reset())
          identified = null
        }
        if (revision !== version) return
        await bounded(client.identify(session))
        if (revision !== version) return
        identified = session
        await bounded(client.page())
      })
      .catch((error: unknown) => {
        client?.dismiss()
        identified = null
        // A later focus, auth report, or online event can retry this same session.
        if (revision === version) desired = null
        reportError(error)
      })
    return queue
  }
  return { update }
}
