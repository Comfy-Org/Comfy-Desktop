/**
 * The assets view of `coreEventTap`, kept so the assets contract's exports and
 * its suite keep their names. The generic tap validates `[assets-event]` lines
 * against `ASSETS_CONTRACT` with the assets-only tap's rules. Its admission
 * differs in two ways: novelty-first admission lets a new failure
 * classification past a spent cap, and open-tier values past 64 distinct per
 * session become `overflow`.
 */
import { ASSETS_CONTRACT } from './coreEventContracts'

export { ASSETS_EVENT_LINE, createCoreEventTap as createAssetsTap } from './coreEventTap'

/** Every assets event name the core call sites emit. */
export const ALLOWED_EVENTS: ReadonlySet<string> = ASSETS_CONTRACT.events

/** Mirror of the field names in ComfyUI `app/assets/event_log.py`. */
export const ALLOWED_FIELD_NAMES: ReadonlySet<string> = ASSETS_CONTRACT.fields
