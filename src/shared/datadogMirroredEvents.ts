/**
 * Allow-list of telemetry event names that mirror to Datadog RUM.
 *
 * Rule ():
 *
 * - Product / funnel / feature event -> PostHog only.
 * - Failure / crash / error event -> both. PostHog for "what % fails"
 * analysis, Datadog for "alert me
 * when failure rate spikes."
 * - Nothing else goes to Datadog.
 *
 * Datadog is not a product-analytics tool; it is the alerting / monitoring
 * tool. Mirroring every event to both doubles RUM volume for no monitor
 * benefit. Mirroring only failures gives ops the alerting surface they need
 * and keeps Datadog cost / noise bounded.
 *
 * Lives in `src/shared/` so main and renderer use the same predicate. Used by
 * `mainTelemetry.forwardToRenderer` (main-side gate before IPC send) and by
 * `rendererBootstrap.trackTelemetryAction` (renderer-side gate before
 * `datadogRum.addAction`).
 *
 * Errors captured via `datadogRum.addError` (window.error,
 * unhandledrejection, main-process forwarded errors) are NOT controlled by
 * this list — they are unconditional. This list governs *Actions only*.
 *
 * Adding a name here is a deliberate ops decision: it means "I want a
 * Datadog monitor on this event." Keep the list tight.
 */

export const DATADOG_MIRRORED_EVENT_NAMES: ReadonlySet<string> = new Set([
  // ComfyUI execution failures — alert on execution error rate per release
  // and per gpu_tier.
  'comfy.desktop.execution.error',
  // ComfyUI process exit — properties carry `crashed: boolean`; monitor
  // filters on crashed=true for the crash-rate signal.
  'comfy.desktop.comfyui.exited',
  // App-update failure — monitors catch update-channel regressions.
  'comfy.desktop.app_update.error',
  // Install pipeline failures — monitors the install funnel's bottom step.
  'comfy.desktop.install.standalone.error',
  'comfy.desktop.install.post_install.error',
  // Per-phase install boundary. Only the `status='error'` rows are the
  // alerting signal (a phase threw); the `start`/`end` rows are PostHog-only
  // funnel timing. `forwardToRenderer` mirrors the whole name, so a Datadog
  // monitor filters on `status:error` to page on a phase failure (e.g.
  // torch_deps_sync hard-failing for a population after a release).
  'comfy.desktop.install.phase',
  // ComfyUI server boot failed — waitForPort timeout / early process exit /
  // renderer did-fail-load / render-process-gone. Paired with the buffered
  // boot_phase timings so a monitor can alert on boot-failure rate per
  // release / variant and the phase breakdown explains where it stalled.
  'comfy.desktop.comfyui.boot_failed',
  // Migration pipeline failures (Desktop-1 -> standalone).
  'comfy.desktop.migrate.flow.error',
  'comfy.desktop.migrate.user_files.error',
  'comfy.desktop.migrate.input.error',
  'comfy.desktop.migrate.output.error',
  'comfy.desktop.migrate.models.error',
  // Snapshot restore failures — partial restores are a known pain point.
  'comfy.desktop.snapshot.restore_comfyui_version.error',
  'comfy.desktop.snapshot.restore_custom_nodes.error',
  'comfy.desktop.snapshot.restore_pip_packages.error',
  // Interrupted update/restore recovery — a hard-killed op left ComfyUI's source
  // moved and we couldn't roll it back. `gave_up=true` means we stopped retrying
  // and let the (likely-inconsistent) install launch anyway.
  'comfy.desktop.recovery.failed',
  // PyTorch vendor repair failure — installs damaged by the brief `--upgrade`
  // window (GPU torch replaced with a CPU build) couldn't be auto-restored from
  // the bundle. Spike means a population is stuck on CPU torch.
  'comfy.desktop.torch_repair.failed',
  // Operational signal for the identity migration rollout.
  'comfy.desktop.identity.migrated',
  // Sign-in failures — alert if a provider's auth bridge breaks (OAuth
  // config drift, IdP outage, loopback-port contention).
  'comfy.desktop.auth.sign_in_failed',
  // SDK-level volume guards — Datadog should alert if either fires
  // because the call site is misbehaving (loop, missing dedup, etc.)
  // and the SDK had to step in. One emit per process per event-name.
  'comfy.desktop.telemetry.rate_limited',
  'comfy.desktop.telemetry.session_cap_hit',
  // pygit2 reliability — spike here means a release broke the bundled
  // Python env for a population of users (signing / quarantine /
  // bootstrap-python copy drift). probe_failed = single-user state;
  // circuit_broken = stop-the-bleeding guard tripped.
  'comfy.desktop.pygit2.probe_failed',
  'comfy.desktop.pygit2.circuit_broken'
])

export function isDatadogMirroredEvent(eventName: string): boolean {
  return DATADOG_MIRRORED_EVENT_NAMES.has(eventName)
}

/**
 * Context keys stripped from the Datadog RUM copy of a mirrored event.
 *
 * Datadog is the alerting surface: monitors group and alert on LOW-cardinality
 * facets (`error_class`, `error_bucket`, `exit_code`, `signal`, phase / variant
 * / retry fields). The free-text diagnostic fields below are high-cardinality
 * and/or large (`error_tail` and `last_stderr` run to kilobytes), which bloats
 * RUM action payloads and pollutes facets for no monitoring benefit. They stay
 * in PostHog (where the actual triage happens); only the Datadog mirror drops
 * them. Mirrors the deliberate choice already made for `auth.sign_in_failed`.
 */
export const DATADOG_DROPPED_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  'error_message',
  'error_signature',
  'error_tail',
  'last_stderr',
])

/**
 * Return a copy of `context` with the high-cardinality / large diagnostic keys
 * removed, for sending to Datadog RUM. Returns the input unchanged when it
 * carries none of them (the common case) to avoid a needless allocation.
 */
export function stripDatadogDroppedKeys<T extends Record<string, unknown>>(context: T): T {
  let out: T | null = null
  for (const key of DATADOG_DROPPED_CONTEXT_KEYS) {
    if (key in context) {
      if (!out) out = { ...context }
      delete out[key]
    }
  }
  return out ?? context
}
