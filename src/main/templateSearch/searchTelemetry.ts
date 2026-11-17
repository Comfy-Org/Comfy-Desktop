import * as telemetry from '../lib/telemetry'
import type { BundleDownload } from './bundles'
import type { StartAttempt } from './service'

const EVENT_PREFIX = 'comfy.desktop.template_search.'

export interface TemplateLoaded {
  searchId: string | null
  templateId: string
  buildStarted: boolean
  pickToLoadMs: number | null
}

export function reportStartAttempt(attempt: StartAttempt): void {
  telemetry.capture(`${EVENT_PREFIX}process_started`, {
    result: attempt.result,
    start_ms: attempt.startMs,
    bundle_version: attempt.bundleVersion,
    is_verified: attempt.verified
  })
}

export function reportBundleDownload(download: BundleDownload): void {
  telemetry.capture(`${EVENT_PREFIX}bundle_downloaded`, {
    result: download.result,
    size_bytes: download.bytes,
    duration_ms: download.durationMs,
    is_background_update: download.background,
    bundle_version: download.version
  })
}

export function reportTemplateLoaded(loaded: TemplateLoaded): void {
  telemetry.capture(`${EVENT_PREFIX}template_loaded`, {
    search_id: loaded.searchId,
    template_id: loaded.templateId,
    build_started: loaded.buildStarted,
    pick_to_load_ms: loaded.pickToLoadMs
  })
}
