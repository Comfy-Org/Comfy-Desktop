const PROD_BUILDER_BASE_URL = 'https://platformapi.comfy.org/builder'
const PROD_PLATFORM_WEB_BASE_URL = 'https://platform.comfy.org'

export const BUILDER_BASE_URL = process.env.COMFY_BUILDER_BASE_URL || PROD_BUILDER_BASE_URL

export const PLATFORM_WEB_BASE_URL =
  process.env.COMFY_PLATFORM_WEB_BASE_URL || PROD_PLATFORM_WEB_BASE_URL
