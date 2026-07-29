/**
 * Comfy Builder on the web — the one place Desktop links out to it, so the
 * URL is a single edit when it needs to follow the API's staging/prod split.
 */
const BUILDER_WEB_URL = 'https://platform.comfy.org/'

/** Hand-off target for "Deploy as Distribution". Deliberately the root: no
 *  Builder route is attested here, and a root can't 404. */
export function buildDeployDistributionUrl(): string {
  const url = new URL(BUILDER_WEB_URL)
  url.searchParams.set('utm_source', 'comfy.desktop')
  url.searchParams.set('utm_medium', 'app_feature')
  return url.toString()
}
