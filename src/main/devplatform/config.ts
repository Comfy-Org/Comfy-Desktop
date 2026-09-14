/**
 * Dev-platform glue config: production defaults for the comfy-builder API and
 * browser app. Deployments can override either URL through the environment.
 */
const PROD_BUILDER_BASE_URL = 'https://platformapi.comfy.org/builder'
const PROD_PLATFORM_WEB_BASE_URL = 'https://platform.comfy.org'

/** Builder gateway base URL the client targets. Prod default; env override. */
export const BUILDER_BASE_URL = process.env.COMFY_BUILDER_BASE_URL || PROD_BUILDER_BASE_URL

/** Browser app base URL. Kept main-side so renderer code cannot choose an origin. */
export const PLATFORM_WEB_BASE_URL =
  process.env.COMFY_PLATFORM_WEB_BASE_URL || PROD_PLATFORM_WEB_BASE_URL
