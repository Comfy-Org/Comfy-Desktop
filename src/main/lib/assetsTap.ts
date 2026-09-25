/**
 * The assets view of `coreEventTap`, kept so the assets contract's exports and
 * its suite keep their names: the generic tap parses `[assets-event]` lines
 * against `ASSETS_CONTRACT` exactly as the assets-only tap did.
 */
import { ASSETS_CONTRACT } from './coreEventContracts'

export { ASSETS_EVENT_LINE, createCoreEventTap as createAssetsTap } from './coreEventTap'

/** Every assets event name the core call sites emit. */
export const ALLOWED_EVENTS: ReadonlySet<string> = ASSETS_CONTRACT.events

/** Mirror of the field names in ComfyUI `app/assets/event_log.py`. */
export const ALLOWED_FIELD_NAMES: ReadonlySet<string> = ASSETS_CONTRACT.fields
