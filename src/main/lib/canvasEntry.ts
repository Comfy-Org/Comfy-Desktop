/**
 * Canvas-rendered telemetry tap (local installs).
 *
 * Fires `comfy.desktop.comfyui.canvas_rendered` the first time a LOCAL
 * install's ComfyUI page reaches dom-ready in a given launch. This is the
 * bottom of the install→canvas funnel: it pins the moment the user actually
 * sees the workflow canvas, which is what the −79% provisioning win is
 * ultimately measured against. The cloud branch already has its own
 * `noteCloudEntered`; this is the local-only counterpart.
 *
 * `server_ready_to_canvas_ms` is the gap between the server becoming
 * ready (the session's `startedAt`, set in `_addSession`) and the page
 * reaching dom-ready — i.e. how long the renderer took to boot the frontend
 * and paint once the backend was up. `null` when no running session is found
 * for the id (the page reloaded after a stop, so there's no server-ready
 * anchor to subtract).
 *
 * Dedup: keyed by installation_id and reset on each launch via
 * `resetCanvasRendered(installationId)` (called from the launch path). The
 * page's `dom-ready` fires again on every in-app reload / re-attach, so
 * without the per-launch guard the event would repeat. `load_failed=true` is
 * emitted from the `did-fail-load` path instead and is NOT deduped by this
 * guard (a failed load is a distinct signal from a successful render).
 *
 * `template_id_or_null` is always `null` here: the template a user opens is a
 * renderer-side concept not observable from main. The prop is kept in the
 * shape so a future renderer-sourced value can populate it without a schema
 * change.
 */
import * as telemetry from './telemetry'
import { getSessionStartedAt } from './ipc/shared'

const _renderedThisLaunch = new Set<string>()

/**
 * Reset the per-launch dedup guard for an installation. Call when a launch
 * begins so the next dom-ready for this id re-fires `canvas_rendered`.
 */
export function resetCanvasRendered(installationId: string): void {
  _renderedThisLaunch.delete(installationId)
}

/**
 * Emit `comfy.desktop.comfyui.canvas_rendered` for a local install's first
 * dom-ready this launch. Subsequent dom-readys for the same id (reloads)
 * no-op. `loadFailed` is set true by the `did-fail-load` path; it bypasses the
 * dedup guard so a failed load is always recorded.
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
