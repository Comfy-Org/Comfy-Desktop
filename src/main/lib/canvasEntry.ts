import * as telemetry from './telemetry'
import { getSessionStartedAt } from './ipc/shared'

const _renderedThisLaunch = new Set<string>()

export function resetCanvasRendered(installationId: string): void {
  _renderedThisLaunch.delete(installationId)
}

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
  const serverReadyToCanvasMs = startedAt !== null ? Math.max(0, Date.now() - startedAt) : null
  telemetry.emit('comfy.desktop.comfyui.canvas_rendered', {
    installation_id: installationId,
    server_ready_to_canvas_ms: serverReadyToCanvasMs,
    template_id_or_null: null,
    load_failed: loadFailed
  })
}

export function _resetForTest(): void {
  _renderedThisLaunch.clear()
}
