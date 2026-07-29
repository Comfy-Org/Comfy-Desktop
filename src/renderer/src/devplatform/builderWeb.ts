/**
 * Comfy Builder on the web — the one place Desktop links out to it, so the
 * URL is a single edit when it needs to follow the API's staging/prod split.
 */
import { DEFAULT_UTM_PARAMS } from '../../../shared/utmParams'

/** The only Builder web origin attested anywhere. */
const DEFAULT_BUILDER_WEB_URL = 'https://platform.comfy.org/'

/** Hand-off target for "Deploy as Distribution", UTM-tagged like the cloud
 *  links. Deliberately the root: no Builder route is attested here, and a root
 *  can't 404. `VITE_COMFY_BUILDER_WEB_URL` repoints it at build time. */
export function builderHandoffUrl(): string {
  const url = new URL(import.meta.env.VITE_COMFY_BUILDER_WEB_URL || DEFAULT_BUILDER_WEB_URL)
  for (const [key, value] of Object.entries(DEFAULT_UTM_PARAMS)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}
