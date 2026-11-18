import * as telemetry from '../lib/telemetry'
import type { BundleDownload } from './bundles'
import type { StartAttempt } from './service'
import { TEMPLATE_SEARCH_EVENT_PREFIX } from '../../shared/templateSearch'

function send(name: string, properties: telemetry.TelemetryContext): void {
  try {
    telemetry.capture(`${TEMPLATE_SEARCH_EVENT_PREFIX}${name}`, properties)
  } catch {
    return
  }
}

export function reportStartAttempt(attempt: StartAttempt): void {
  send('process_started', {
    result: attempt.result,
    start_ms: attempt.startMs,
    bundle_version: attempt.bundleVersion,
    is_verified: attempt.verified
  })
}

export function reportBundleDownload(download: BundleDownload): void {
  send('bundle_downloaded', {
    result: download.result,
    size_bytes: download.bytes,
    duration_ms: download.durationMs,
    trigger: download.trigger,
    bundle_version: download.version
  })
}
