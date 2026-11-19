import * as installations from '../installations'

export interface FirstUseDetection {
  skipPick: boolean
  hasLegacyDesktop: boolean
}

export async function detectFirstUseState(): Promise<FirstUseDetection> {
  const all = await installations.list()
  let skipPick = false
  let hasLegacyDesktop = false
  for (const inst of all) {
    if (inst.sourceId === 'desktop') {
      hasLegacyDesktop = true
      continue
    }
    if (inst.sourceId === 'cloud') continue
    skipPick = true
  }
  return { skipPick, hasLegacyDesktop }
}
