import * as telemetry from '../lib/telemetry'
import type { BundleDownload } from './bundles'
import type { StartAttempt } from './service'

const EVENT_PREFIX = 'comfy.desktop.template_search.'

export interface TemplateSent {
  searchId: string | null
  templateId: string
  pickToSendMs: number
}

function send(name: string, properties: telemetry.TelemetryContext): void {
  try {
    telemetry.capture(`${EVENT_PREFIX}${name}`, properties)
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
    is_background_update: download.background,
    bundle_version: download.version
  })
}

export function reportTemplateSent(sent: TemplateSent): void {
  send('template_sent_to_build', {
    search_id: sent.searchId,
    template_id: sent.templateId,
    pick_to_send_ms: sent.pickToSendMs
  })
}
