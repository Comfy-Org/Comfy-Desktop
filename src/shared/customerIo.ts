/** Public browser ingest configuration; these are not Customer.io App API secrets. */
export const CUSTOMER_IO_DEFAULTS = {
  writeKey: '9cfddc92b9ca1ff1f64b',
  siteId: 'f87746f8c188c8ddcf41'
}

export const CUSTOMER_IO_READY = 'customerio:ready'
export const CUSTOMER_IO_STATE = 'customerio:state'
export const CUSTOMER_IO_ACTION = 'customerio:action'

/** Stable page names used by Customer.io's in-app page rules. */
export const CUSTOMER_IO_PAGES = {
  comfyui: 'desktop/comfyui',
  launcher: 'desktop/launcher'
} as const
export type CustomerIoPage = (typeof CUSTOMER_IO_PAGES)[keyof typeof CUSTOMER_IO_PAGES]

export interface CustomerIoSession {
  userId: string
  locale: string
  writeKey: string
  siteId: string
  page: CustomerIoPage
}
