import * as installations from '../installations'
import { isAppsBuild } from '../../shared/appsBuild'

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
    if (inst.sourceId === 'cloud' || isAppsBuild(inst)) continue
    skipPick = true
  }
  return { skipPick, hasLegacyDesktop }
}
