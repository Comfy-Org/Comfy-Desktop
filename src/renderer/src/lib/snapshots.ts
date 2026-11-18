import type { SnapshotDiffResult, SnapshotListData, SnapshotSummary } from '../types/ipc'

type Translator = (key: string, params?: Record<string, unknown>) => string

const _snapshotListCache = new Map<string, SnapshotListData>()
export function getCachedSnapshotList(installationId: string): SnapshotListData | null {
  return _snapshotListCache.get(installationId) ?? null
}
export function setCachedSnapshotList(installationId: string, data: SnapshotListData): void {
  _snapshotListCache.set(installationId, data)
}

export async function shareLatestSnapshot(
  installationId: string
): Promise<{ ok: true } | { ok: false; reason: 'none' | 'error'; message?: string }> {
  const list = await window.api.getSnapshots(installationId)
  const latest = list?.snapshots?.[0]?.filename
  if (!latest) return { ok: false, reason: 'none' }
  const result = await window.api.exportSnapshot(installationId, latest)
  if (result.ok) return { ok: true }
  if (result.message) return { ok: false, reason: 'error', message: result.message }
  return { ok: true }
}

const LEGACY_SENTINEL_LABELS = new Set(['before-update', 'after-update', 'after-restore'])

export function isDisplayableLabel(label: string | null | undefined): boolean {
  return !!label && !LEGACY_SENTINEL_LABELS.has(label)
}

export function triggerLabel(trigger: string, t: (key: string) => string): string {
  switch (trigger) {
    case 'boot':
      return t('snapshots.triggerBoot')
    case 'restart':
      return t('snapshots.triggerRestart')
    case 'manual':
      return t('snapshots.triggerManual')
    case 'pre-update':
      return t('snapshots.triggerPreUpdate')
    case 'post-update':
      return t('snapshots.triggerPostUpdate')
    case 'post-restore':
      return t('snapshots.triggerPostRestore')
    default:
      return trigger
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function formatNodeVersion(node: { version?: string; commit?: string }): string {
  if (node.version) return node.version
  if (node.commit) return node.commit.slice(0, 7)
  return '—'
}

export function triggerClass(trigger: string): string {
  switch (trigger) {
    case 'boot':
      return 'trigger-boot'
    case 'restart':
      return 'trigger-restart'
    case 'manual':
      return 'trigger-manual'
    case 'pre-update':
      return 'trigger-preupdate'
    case 'post-update':
      return 'trigger-postupdate'
    case 'post-restore':
      return 'trigger-postrestore'
    default:
      return ''
  }
}

export function formatRelative(iso: string, t: Translator): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('snapshots.timeJustNow')
  if (mins < 60) return t('snapshots.timeMinutesAgo', { count: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('snapshots.timeHoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('snapshots.timeDaysAgo', { count: days })
  return new Date(iso).toLocaleDateString()
}

export function copyReasonLabel(reason: string, t: Translator): string {
  switch (reason) {
    case 'copy-update':
      return t('snapshots.copyUpdatedAs')
    case 'copy-pytorch':
      return t('snapshots.copyPytorchAs')
    case 'release-update':
      return t('snapshots.releaseUpdatedAs')
    default:
      return t('snapshots.copiedAs')
  }
}

export function changeSummary(s: SnapshotSummary, t: Translator): string[] {
  if (!s.diffVsPrevious) return []
  const parts: string[] = []
  const d = s.diffVsPrevious
  if (d.comfyuiChanged) parts.push(t('snapshots.comfyuiUpdated'))
  if (d.updateChannelChanged) parts.push(t('snapshots.channelChanged'))
  const nodeChanges = d.nodesAdded + d.nodesRemoved + d.nodesChanged
  if (nodeChanges > 0) {
    const nodeParts: string[] = []
    if (d.nodesAdded > 0) nodeParts.push(`+${d.nodesAdded}`)
    if (d.nodesRemoved > 0) nodeParts.push(`−${d.nodesRemoved}`)
    if (d.nodesChanged > 0) nodeParts.push(`~${d.nodesChanged}`)
    parts.push(`${nodeParts.join(' ')} nodes`)
  }
  const pipChanges = d.pipsAdded + d.pipsRemoved + d.pipsChanged
  if (pipChanges > 0) {
    parts.push(t('snapshots.pipChanges', { count: pipChanges }))
  }
  return parts
}

export function diffToDetailGroups(
  diff: SnapshotDiffResult,
  t: Translator,
  cap = 12
): Array<{ label: string; items: string[] }> {
  const groups: Array<{ label: string; items: string[] }> = []
  const capList = (lines: string[]): string[] =>
    lines.length > cap ? [...lines.slice(0, cap), `… and ${lines.length - cap} more`] : lines

  if (diff.comfyuiChanged && diff.comfyui) {
    groups.push({
      label: t('snapshots.comfyuiVersion'),
      items: [`${diff.comfyui.from.formattedVersion} → ${diff.comfyui.to.formattedVersion}`]
    })
  }
  if (diff.updateChannelChanged && diff.updateChannel) {
    groups.push({
      label: t('snapshots.updateChannel'),
      items: [`${diff.updateChannel.from} → ${diff.updateChannel.to}`]
    })
  }
  if (diff.nodesAdded.length || diff.nodesRemoved.length || diff.nodesChanged.length) {
    const lines = [
      ...diff.nodesAdded.map((n) => `+ ${n.id} ${formatNodeVersion(n)}`),
      ...diff.nodesRemoved.map((n) => `− ${n.id} ${formatNodeVersion(n)}`),
      ...diff.nodesChanged.map(
        (n) => `~ ${n.id}: ${formatNodeVersion(n.from)} → ${formatNodeVersion(n.to)}`
      )
    ]
    groups.push({ label: t('snapshots.customNodes'), items: capList(lines) })
  }
  if (diff.pipsAdded.length || diff.pipsRemoved.length || diff.pipsChanged.length) {
    const lines = [
      ...diff.pipsAdded.map((p) => `+ ${p.name} ${p.version}`),
      ...diff.pipsRemoved.map((p) => `− ${p.name} ${p.version}`),
      ...diff.pipsChanged.map((p) => `~ ${p.name}: ${p.from} → ${p.to}`)
    ]
    groups.push({ label: t('snapshots.pipPackages'), items: capList(lines) })
  }
  return groups
}

export function diffHasChanges(diff: SnapshotDiffResult): boolean {
  return (
    diff.comfyuiChanged ||
    diff.updateChannelChanged ||
    diff.nodesAdded.length > 0 ||
    diff.nodesRemoved.length > 0 ||
    diff.nodesChanged.length > 0 ||
    diff.pipsAdded.length > 0 ||
    diff.pipsRemoved.length > 0 ||
    diff.pipsChanged.length > 0
  )
}
