/**
 * Dev-platform glue config: env DEFAULTS for the comfy-builder base URL. A real
 * deployment can override `COMFY_BUILDER_BASE_URL` via the environment. The
 * cloud issuer default lives in `../cloud/config.ts` (prod).
 */
const PROD_BUILDER_BASE_URL = 'https://platformapi.comfy.org/builder'

/** Builder gateway base URL the client targets. Prod default; env override. */
export const BUILDER_BASE_URL = process.env.COMFY_BUILDER_BASE_URL || PROD_BUILDER_BASE_URL
