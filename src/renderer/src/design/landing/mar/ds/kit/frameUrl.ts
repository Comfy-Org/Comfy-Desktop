/** A frame of this page in the current theme (see boot.ts). */
export function frameUrl(
  frame: 'stage' | 'app',
  params: Record<string, string | undefined>,
  seed?: Record<string, unknown>
): string {
  const q = new URLSearchParams({
    frame,
    theme: new URLSearchParams(location.search).get('theme') ?? 'dark'
  })
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
  if (seed) q.set('seed', JSON.stringify(seed))
  return `?${q}`
}
