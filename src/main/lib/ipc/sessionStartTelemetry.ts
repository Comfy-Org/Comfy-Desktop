import * as telemetry from '../telemetry'
import * as settings from '../../settings'
import { buildInstallationDdContext, sourceMap } from './shared'
import { scrubAll } from '../../../shared/piiScrub'
import type { SessionKind } from '../../../shared/performanceTestSession'

const MAX_TELEMETRY_JSON_LENGTH = 768 * 1024

function serializeForTelemetry(value: unknown): { json: string | null; truncated: boolean } {
  const json = JSON.stringify(value)
  if (json.length > MAX_TELEMETRY_JSON_LENGTH) return { json: null, truncated: true }
  return { json, truncated: false }
}

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
  bootTimeMs?: number
  portRetries: number
  rebootRetries: number
  sessionKind: SessionKind
}

export async function emitInstanceStartedTelemetry(info: InstanceStartedInfo): Promise<void> {
  try {
    const ctx = await buildInstallationDdContext(info.installationId)
    if (!ctx) return

    const { snapshot_diffs, latest_snapshot, ...metadata } = ctx

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

    const sourceCategory = sourceMap[ctx.source_id]?.category
    const instanceStartedProps = {
      ...(metadata as Record<string, string | number | boolean | null | undefined>),
      ...settings.getTrackedSettingsTelemetryProperties(),
      deployment: telemetry.asDeployment(sourceCategory),
      boot_time_ms: info.bootTimeMs ?? null,
      port_retries: info.portRetries,
      reboot_retries: info.rebootRetries,
      session_kind: info.sessionKind,
      custom_nodes_count: latest_snapshot?.customNodes.length ?? null,
      pip_packages_count: latest_snapshot ? Object.keys(latest_snapshot.pipPackages).length : null,
      latest_snapshot_json: latestSnapshotJson.json,
      latest_snapshot_json_truncated: latestSnapshotJson.truncated
    }
    telemetry.capture('comfy.desktop.session.instance_started', instanceStartedProps)
    telemetry.capture('comfy.desktop.session.installation_started', instanceStartedProps)
    if (sourceCategory === 'local') {
      telemetry.registerPersonPropertiesOnce({
        first_local_instance_started_at: new Date().toISOString()
      })
    }

    if (snapshot_diffs.length > 0) {
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
  } catch {}
}
