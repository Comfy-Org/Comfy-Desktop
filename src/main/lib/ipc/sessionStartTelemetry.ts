/**
 * Main-process emitters for the per-instance session-start telemetry:
 * `session.instance_started`, the deprecated `session.installation_started`
 * shadow, and `session.snapshot_history`.
 *
 * These used to fire from the panel renderer's `onInstanceStarted` handler, but
 * Desktop 2's unified window destroys/swaps the dashboard panel around
 * server-ready, so the renderer callback frequently never ran and the events
 * silently vanished from rc.3 onward. Emitting from main — on the same
 * `_addSession` that drives the `instance-started` broadcast — makes them fire
 * reliably regardless of renderer lifecycle, with the exact same event names
 * and property shapes so existing dashboards/SQL keep working.
 */
import * as telemetry from '../telemetry'
import { buildInstallationDdContext } from './shared'
import { scrubAll } from '../../../shared/piiScrub'

// Mirror the IPC bridge's large-`_json` ceiling so a structured payload either
// ships intact or is omitted with a `*_truncated` flag — never sliced mid-string
// into invalid JSON. Kept under PostHog's 1 MB per-event hard limit.
const MAX_TELEMETRY_JSON_LENGTH = 768 * 1024

function serializeForTelemetry(value: unknown): { json: string | null; truncated: boolean } {
  const json = JSON.stringify(value)
  if (json.length > MAX_TELEMETRY_JSON_LENGTH) return { json: null, truncated: true }
  return { json, truncated: false }
}

// Scrub every pip spec value (an editable/local install can embed a home-dir
// path like `pkg @ file:///C:/Users/<name>/...`) while leaving package names
// untouched. Runs at the emit site so the scrub is intentional and the
// serialized-JSON safety net never has to redact a path mid-string.
function scrubPipSpecs(pipPackages: Record<string, string>): Record<string, string> {
  const scrubbed: Record<string, string> = {}
  for (const [name, spec] of Object.entries(pipPackages)) {
    scrubbed[name] = scrubAll(spec)
  }
  return scrubbed
}

interface SnapshotNodeFields {
  id: string
  type: string
  dirName: string
  enabled: boolean
  version?: string
  commit?: string
}

// Single source of truth for the snapshot custom-node shape sent to telemetry,
// shared by the latest-snapshot and per-diff node arrays so they can't drift.
// `id`/`dirName` are folder/project names (never absolute paths today) but are
// run through `scrubAll` as defense-in-depth; `version`/`commit` are git refs.
function serializeSnapshotNode(n: SnapshotNodeFields): {
  id: string
  type: string
  dirName: string
  enabled: boolean
  version: string | null
  commit: string | null
} {
  return {
    id: scrubAll(n.id),
    type: n.type,
    dirName: scrubAll(n.dirName),
    enabled: n.enabled,
    version: n.version ?? null,
    commit: n.commit ?? null
  }
}

// Shape of a single `snapshot_diffs` entry from `buildInstallationDdContext`
// (typed there as `Record<string, unknown>` since it's built dynamically).
interface RawSnapshotDiff {
  createdAt: string
  trigger: string
  label?: string | null
  nodesAdded: SnapshotNodeFields[]
  nodesRemoved: SnapshotNodeFields[]
  nodesChanged: Array<{ id: string; from: string; to: string }>
  pipsAdded: Array<{ name: string; version: string }>
  pipsRemoved: Array<{ name: string; version: string }>
  pipsChanged: Array<{ name: string; from: string; to: string }>
  comfyuiChanged: boolean
  comfyui?: unknown
  updateChannelChanged: boolean
  updateChannel?: unknown
}

export interface InstanceStartedInfo {
  installationId: string
  /** Wall-clock ms from launch start to server-ready, folded onto the event. */
  bootTimeMs?: number
  /** Spawn-retry counts for THIS boot (0 on the remote / skip-port paths). */
  portRetries: number
  rebootRetries: number
}

/**
 * Fire-and-forget. Invoked from `_addSession` (via the `onInstanceStarted`
 * callback) on every ComfyUI instance boot. Builds the installation snapshot
 * context, scrubs PII at the emit site, and captures the session-start events.
 */
export async function emitInstanceStartedTelemetry(info: InstanceStartedInfo): Promise<void> {
  try {
    const ctx = await buildInstallationDdContext(info.installationId)
    if (!ctx) return

    const { snapshot_diffs, latest_snapshot, ...metadata } = ctx

    // Forward the FULL latest snapshot so an installation's exact state (every
    // custom node + pip package, with versions) is queryable, and earlier
    // states can be reconstructed by walking `snapshot_diffs` back from it. The
    // only genuine PII is the user-typed `label` (kept as a boolean
    // `has_label`); package/node names and versions are public identifiers.
    // Editable/local pip specs can embed a home-dir path, so each spec value is
    // run through `scrubAll` here at the emit site.
    const latestSnapshotFull = latest_snapshot
      ? {
          createdAt: latest_snapshot.createdAt,
          trigger: latest_snapshot.trigger,
          has_label: latest_snapshot.label != null,
          comfyui: latest_snapshot.comfyui,
          customNodes: latest_snapshot.customNodes.map(serializeSnapshotNode),
          pipPackages: scrubPipSpecs(latest_snapshot.pipPackages),
          python_version: latest_snapshot.pythonVersion ?? null,
          update_channel: latest_snapshot.updateChannel ?? null
        }
      : null
    const latestSnapshotJson = serializeForTelemetry(latestSnapshotFull)

    // Fires on EVERY ComfyUI instance boot (fresh install, restart, port
    // realloc) — not on new-install completion. Despite its previous name
    // (`session.installation_started`) it tracks per-instance boots. The old
    // name is also emitted below for one release cycle so existing PostHog
    // dashboards stay alive while migration happens (issue #1054).
    const instanceStartedProps = {
      ...(metadata as Record<string, string | number | boolean | null | undefined>),
      boot_time_ms: info.bootTimeMs ?? null,
      port_retries: info.portRetries,
      reboot_retries: info.rebootRetries,
      // Top-level so they stay queryable in PostHog's UI and survive even when
      // `latest_snapshot_json` is dropped by the size cap (heavy installs are
      // exactly the ones most likely to truncate).
      custom_nodes_count: latest_snapshot?.customNodes.length ?? null,
      pip_packages_count: latest_snapshot
        ? Object.keys(latest_snapshot.pipPackages).length
        : null,
      latest_snapshot_json: latestSnapshotJson.json,
      latest_snapshot_json_truncated: latestSnapshotJson.truncated
    }
    telemetry.capture('comfy.desktop.session.instance_started', instanceStartedProps)
    // DEPRECATED 2026-06-12: misleadingly named — remove after 2026-07-01 once
    // consumers migrate to `session.instance_started`. Tracked in issue #1054.
    telemetry.capture('comfy.desktop.session.installation_started', instanceStartedProps)

    if (snapshot_diffs.length > 0) {
      // Forward the FULL per-transition diffs (which nodes/packages were
      // added/removed/changed, with versions) so the entire snapshot history
      // can be reconstructed by applying these deltas backward from
      // `latest_snapshot`. Drop only the user-typed `label` (kept as
      // `has_label`); names/versions are public identifiers, and each pip spec
      // value is run through `scrubAll` here at the emit site. PostHog only, per
      // the Datadog "failures-only" policy.
      const snapshotDiffsFull = (snapshot_diffs as unknown as RawSnapshotDiff[]).map((d) => ({
        createdAt: d.createdAt,
        trigger: d.trigger,
        has_label: d.label != null,
        nodesAdded: d.nodesAdded.map(serializeSnapshotNode),
        nodesRemoved: d.nodesRemoved.map(serializeSnapshotNode),
        nodesChanged: d.nodesChanged.map((n) => ({
          id: scrubAll(n.id),
          from: n.from,
          to: n.to
        })),
        pipsAdded: d.pipsAdded.map((p) => ({ name: p.name, version: scrubAll(p.version) })),
        pipsRemoved: d.pipsRemoved.map((p) => ({ name: p.name, version: scrubAll(p.version) })),
        pipsChanged: d.pipsChanged.map((p) => ({
          name: p.name,
          from: scrubAll(p.from),
          to: scrubAll(p.to)
        })),
        comfyuiChanged: d.comfyuiChanged,
        comfyui: d.comfyui ?? null,
        updateChannelChanged: d.updateChannelChanged,
        updateChannel: d.updateChannel ?? null
      }))
      const snapshotDiffsJson = serializeForTelemetry(snapshotDiffsFull)
      telemetry.capture('comfy.desktop.session.snapshot_history', {
        installation_id: ctx.installation_id,
        snapshot_count: snapshot_diffs.length,
        snapshot_diffs_json: snapshotDiffsJson.json,
        snapshot_diffs_json_truncated: snapshotDiffsJson.truncated
      })
    }
  } catch {
    // Telemetry must never break a launch.
  }
}
