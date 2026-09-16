import { EventEmitter } from 'node:events'

/** Refresh messaging after an authoritative auth, consent, or locale change. */
export const customerIoEvents = new EventEmitter()
