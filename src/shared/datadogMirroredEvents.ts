export const DATADOG_MIRRORED_EVENT_NAMES: ReadonlySet<string> = new Set([
  'comfy.desktop.auth.view_token_mint_failed',
  'comfy.desktop.auth.workspace_switch_browser',
  'comfy.desktop.auth.workspace_returned_to_anchor',
  'comfy.desktop.auth.mint_scope_not_granted',

  'comfy.desktop.execution.error',
  'comfy.desktop.comfyui.exited',
  'comfy.desktop.app_update.error',
  'comfy.desktop.install.standalone.error',
  'comfy.desktop.install.post_install.error',
  'comfy.desktop.install.phase',
  'comfy.desktop.install.not_started',
  'comfy.desktop.comfyui.boot_failed',
  'comfy.desktop.comfyui.asset_scan_error',
  'comfy.desktop.migrate.flow.error',
  'comfy.desktop.migrate.user_files.error',
  'comfy.desktop.migrate.input.error',
  'comfy.desktop.migrate.output.error',
  'comfy.desktop.migrate.models.error',
  'comfy.desktop.snapshot.restore_comfyui_version.error',
  'comfy.desktop.snapshot.restore_custom_nodes.error',
  'comfy.desktop.snapshot.restore_pip_packages.error',
  'comfy.desktop.recovery.failed',
  'comfy.desktop.torch_repair.failed',
  'comfy.desktop.identity.migrated',
  'comfy.desktop.auth.sign_in_failed',
  'comfy.desktop.auth.host_sign_in',
  'comfy.desktop.telemetry.rate_limited',
  'comfy.desktop.telemetry.session_cap_hit',
  'comfy.desktop.pygit2.probe_failed',
  'comfy.desktop.pygit2.circuit_broken',
  'comfy.desktop.comfyui.assets.scanner.hash_failed',
  'comfy.desktop.comfyui.assets.scanner.enrich_failed',
  'comfy.desktop.comfyui.assets.scanner.fast_scan_failed',
  'comfy.desktop.comfyui.assets.scanner.temp_sync_failed',
  'comfy.desktop.comfyui.assets.scanner.mark_missing_failed',
  'comfy.desktop.comfyui.assets.scanner.stat_failed',
  'comfy.desktop.comfyui.assets.scanner.watch_stat_failed',
  'comfy.desktop.comfyui.assets.scanner.watch_spec_failed',
  'comfy.desktop.comfyui.assets.scanner.watch_seed_failed',
  'comfy.desktop.comfyui.assets.scanner.root_unreachable',
  'comfy.desktop.comfyui.assets.scanner.walk_failed',
  'comfy.desktop.comfyui.assets.scanner.metadata_failed',
  'comfy.desktop.comfyui.assets.seeder.batch_insert_failed',
  'comfy.desktop.comfyui.assets.seeder.scan_failed',
  'comfy.desktop.comfyui.agent.startup_failed',
  'comfy.desktop.comfyui.agent.startup_stalled',
  'comfy.desktop.comfyui.agent.health_check_failed',
  'comfy.desktop.comfyui.agent.agent_error',
  'comfy.desktop.comfyui.agent.document_host_degraded'
])

export function isDatadogMirroredEvent(eventName: string): boolean {
  return DATADOG_MIRRORED_EVENT_NAMES.has(eventName)
}

export const DATADOG_DROPPED_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  'error_message',
  'error_signature',
  'error_tail',
  'error_traceback',
  'error_stack',
  'last_stderr'
])

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

export const RENDERER_COHORT_CONTEXT_KEYS = [
  'app_version',
  'app_channel',
  'locale',
  'theme',
  'telemetry_enabled',
  'first_use_completed',
  'local_installation_count',
  'has_launched_cloud',
  'has_legacy_install'
] as const

export type RendererCohortContextKey = (typeof RENDERER_COHORT_CONTEXT_KEYS)[number]

export const DATADOG_GLOBAL_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  ...RENDERER_COHORT_CONTEXT_KEYS,
  'renderer_role'
])
