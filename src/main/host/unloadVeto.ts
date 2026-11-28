import type { WebContents } from 'electron'

const vetoListeners = new Map<WebContents, () => void>()

export function takeUnloadVeto(contents: WebContents): boolean {
  const listener = vetoListeners.get(contents)
  if (!listener) return false
  listener()
  return true
}

export async function leavesWithoutVeto(
  contents: WebContents,
  leave: () => Promise<unknown>
): Promise<boolean> {
  let vetoed!: () => void
  const veto = new Promise<false>((resolve) => (vetoed = () => resolve(false)))
  vetoListeners.set(contents, vetoed)
  try {
    return await Promise.race([veto, leave().then(() => true)])
  } finally {
    vetoListeners.delete(contents)
  }
}
