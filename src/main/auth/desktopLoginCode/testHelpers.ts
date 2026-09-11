export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

/** Fetch stub that stays pending until its abort signal fires. */
export function hangingFetch(): typeof fetch {
  return (...args: Parameters<typeof fetch>) =>
    new Promise<Response>((_resolve, reject) => {
      args[1]?.signal?.addEventListener('abort', () =>
        reject(new DOMException('This operation was aborted', 'AbortError'))
      )
    })
}
