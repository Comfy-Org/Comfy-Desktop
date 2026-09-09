function flowAbortError(): Error {
  const error = new Error('sign-in flow aborted')
  error.name = 'AbortError'
  return error
}

/** Reject a pending operation when its owning sign-in flow is superseded. */
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw flowAbortError()
  let onAbort!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(flowAbortError())
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([promise, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** Abort-aware delay shared by both browser sign-in paths. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(flowAbortError())
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(flowAbortError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
