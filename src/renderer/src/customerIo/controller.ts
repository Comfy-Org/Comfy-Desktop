import type { CustomerIoSession } from '../../../shared/customerIo'

export interface MessagingClient {
  identify(session: CustomerIoSession): Promise<void>
  page(session: CustomerIoSession): Promise<void>
  reset(): Promise<void>
  dismiss(): void
}

async function bounded(operation: Promise<void>, onTimeout: () => void): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      operation,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          onTimeout()
          resolve()
        }, 10_000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** One owner of SDK operations; only the caller's wait may time out. */
export function createMessagingController(
  load: (
    session: CustomerIoSession,
    currentSession: () => CustomerIoSession | null
  ) => Promise<MessagingClient>,
  reportError: (error: unknown) => void = (error) =>
    console.warn('Desktop messaging is unavailable', error)
): { update: (session: CustomerIoSession | null) => Promise<void> } {
  let desired: CustomerIoSession | null = null
  let permitted: CustomerIoSession | null = null
  let client: MessagingClient | null = null
  let identified: CustomerIoSession | null = null
  let version = 0
  let retry = false
  let queue = Promise.resolve()
  let completion = queue
  function update(session: CustomerIoSession | null): Promise<void> {
    if (!retry && JSON.stringify(desired) === JSON.stringify(session)) return completion
    desired = session
    permitted = null
    retry = false
    const revision = ++version
    let expired = false
    let failed = false
    const isCurrent = (): boolean => revision === version && !expired
    // Revoke before waiting for a previous operation to release the SDK.
    if (!session || identified?.userId !== session.userId) client?.dismiss()
    queue = queue
      .then(async () => {
        if (!isCurrent()) return
        if (!session) {
          if (client) await client.reset()
          identified = null
          return
        }
        client ??= await load(session, () => permitted)
        if (!isCurrent()) return
        if (identified?.userId !== session.userId) {
          await client.reset()
          identified = null
        }
        if (!isCurrent()) return
        permitted = session
        await client.identify(session)
        if (!isCurrent()) return
        identified = session
        await client.page(session)
      })
      .catch((error: unknown) => {
        failed = true
        client?.dismiss()
        identified = null
        if (revision === version) {
          permitted = null
          // A later focus, auth report, or online event can retry this session.
          retry = true
        }
        reportError(error)
      })
      .then(() => {
        if (!isCurrent()) client?.dismiss()
        // A late successful operation releases ownership. Reconcile the latest
        // session from reset; never resume the expired identity/page sequence.
        if (expired && !failed && revision === version) void update(desired)
      })
    completion = bounded(queue, () => {
      expired = true
      if (revision === version) {
        permitted = null
        identified = null
        retry = true
        client?.dismiss()
      }
      reportError(new Error('Customer.io operation timed out'))
    })
    return completion
  }
  return { update }
}
