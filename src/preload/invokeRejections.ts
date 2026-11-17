const ELECTRON_INVOKE_WRAPPER = /^Error invoking remote method '[^']*': /
const THROWN_ERROR_NAME = /^[A-Z][\w$]*(?: \[\w+\])?(?:: |$)/

type BridgeMethod = (...args: unknown[]) => unknown

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === 'function'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  )
}

function messageThrownByHandler(invokeRejection: unknown): string | null {
  const message = (invokeRejection as { message?: unknown } | null)?.message
  if (typeof message !== 'string') return null
  const wrapper = ELECTRON_INVOKE_WRAPPER.exec(message)
  if (!wrapper) return null
  return message.slice(wrapper[0].length).replace(THROWN_ERROR_NAME, '')
}

function rethrowWithHandlerMessage(invokeRejection: unknown): never {
  const message = messageThrownByHandler(invokeRejection)
  if (message === null) throw invokeRejection
  throw new Error(message, { cause: invokeRejection })
}

function rejectingWithHandlerMessage(method: BridgeMethod): BridgeMethod {
  return (...args) => {
    const result = method(...args)
    return isPromiseLike(result) ? Promise.resolve(result).catch(rethrowWithHandlerMessage) : result
  }
}

export function rejectingWithHandlerMessages<Bridge extends object>(bridge: Bridge): Bridge {
  return Object.fromEntries(
    Object.entries(bridge).map(([name, member]) => {
      if (typeof member === 'function') return [name, rejectingWithHandlerMessage(member)]
      if (isPlainObject(member)) return [name, rejectingWithHandlerMessages(member)]
      return [name, member]
    })
  ) as Bridge
}
