/**
 * Dev-platform glue config: points the cloud + comfy-builder libraries at
 * staging for now.
 *
 * These are env DEFAULTS, not hardcodes: a real deployment can still override
 * `COMFY_CLOUD_ISSUER` / `COMFY_BUILDER_BASE_URL` via the environment. This
 * module is imported (for its side effect) BEFORE the cloud library's own
 * `config` module, so the issuer default is in place by the time
 * `CLOUD_ISSUER` is computed: do not reorder the import in `./session`.
 */
const STAGING_CLOUD_ISSUER = 'https://stagingcloud.comfy.org'
const STAGING_BUILDER_BASE_URL = 'https://stagingplatformapi.comfy.org/builder'

if (!process.env.COMFY_CLOUD_ISSUER) {
  process.env.COMFY_CLOUD_ISSUER = STAGING_CLOUD_ISSUER
}

/** Builder gateway base URL the client targets. Staging default; env override. */
export const BUILDER_BASE_URL = process.env.COMFY_BUILDER_BASE_URL || STAGING_BUILDER_BASE_URL
