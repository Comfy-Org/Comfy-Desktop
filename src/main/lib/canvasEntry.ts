/**
 * Canvas-rendered tap (local installs) — bottom of the install→canvas funnel.
 * Fires `comfy.desktop.comfyui.canvas_rendered` on a local install's first
 * dom-ready per launch (deduped via `resetCanvasRendered`; `did-fail-load`
 * emits `load_failed=true` and bypasses the dedup). `server_ready_to_canvas_ms`
 * = session `startedAt` → dom-ready (null if no running session). The cloud
 * branch has its own `noteCloudEntered`. `template_id_or_null` is always null
 * here (template is renderer-side, not observable from main).
 */
import * as telemetry from './telemetry'
import { getSessionStartedAt } from './ipc/shared'

const _renderedThisLaunch = new Set<string>()

/** Reset the per-launch dedup guard so the next dom-ready re-fires `canvas_rendered`. */
export function resetCanvasRendered(installationId: string): void {
  _renderedThisLaunch.delete(installationId)
}

/**
 * Emit `canvas_rendered` on a local install's first dom-ready this launch
 * (reloads no-op; `loadFailed` bypasses the dedup so failed loads are recorded).
 */
export function noteCanvasRendered(
  installationId: string,
  opts: { loadFailed?: boolean } = {}
): void {
  const loadFailed = opts.loadFailed === true
  if (!loadFailed) {
    if (_renderedThisLaunch.has(installationId)) return
    _renderedThisLaunch.add(installationId)
  }
  const startedAt = getSessionStartedAt(installationId)
  const serverReadyToCanvasMs = startedAt !== null ? Date.now() - startedAt : null
  telemetry.emit('comfy.desktop.comfyui.canvas_rendered', {
    installation_id: installationId,
    server_ready_to_canvas_ms: serverReadyToCanvasMs,
    template_id_or_null: null,
    load_failed: loadFailed
  })
}

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  _renderedThisLaunch.clear()
}
