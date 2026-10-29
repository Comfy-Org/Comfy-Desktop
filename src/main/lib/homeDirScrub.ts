import os from 'os'
import { setScrubbedHomeDir } from '../../shared/piiScrub'

/**
 * Scrub every spelling of the real home directory from off-box telemetry,
 * including profiles relocated outside `Users` / `home`.
 */
export function registerHomeDirScrub(homedir: () => string = os.homedir): void {
  try {
    setScrubbedHomeDir(homedir())
  } catch {
    // os.homedir() throws when the OS reports no home; the generic patterns still apply.
  }
}
