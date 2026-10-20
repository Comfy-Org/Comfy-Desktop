import os from 'os'
import path from 'path'
import type { TitleMenuIcon, TitleMenuRow } from '../../types/ipc'
import type { InstancePickerInstall } from './titlePopup'
import { formatRelativeFromMs } from '../../shared/datetime'

/**
 * The breadcrumb title bar's two menus, composed in main from the install
 * list and the running sessions: the build switcher (under the chevron) and a
 * build's info card (on hovering its name). Ids are namespaced so a pick can
 * only ever mean one of these actions.
 */
export const SWITCHER_DASHBOARD = 'switcher:dashboard'
export const SWITCHER_MANAGE = 'switcher:manage'
export const SWITCHER_OPEN_PREFIX = 'switcher:open:'
export const INFO_SETTINGS = 'info:settings'
export const INFO_FOLDER = 'info:folder'
export const INFO_CLOSE = 'info:close'

export interface BuildMenuFacts {
  installs: readonly InstancePickerInstall[]
  running: ReadonlySet<string>
  launching: ReadonlySet<string>
  /** Builds that have a window open. */
  withWindow: ReadonlySet<string>
  /** The build this window shows, or null in the dashboard window. */
  currentId: string | null
  /** Comfy Cloud's host, shown as a Cloud build's location. */
  cloudHost: string
}

type Translate = (key: string, params?: Record<string, string | number>) => string

const SEPARATOR: TitleMenuRow = { kind: 'separator' }

function iconFor(inst: InstancePickerInstall): TitleMenuIcon {
  if (inst.sourceCategory === 'cloud') return 'cloud'
  if (inst.sourceCategory === 'remote') return 'remote'
  return 'local'
}

function statusOf(inst: InstancePickerInstall, f: BuildMenuFacts): TitleMenuRow['status'] {
  if (f.launching.has(inst.id)) return 'busy'
  if (f.running.has(inst.id)) return 'running'
  if (inst.statusTag?.style === 'danger') return 'error'
  return inst.sourceCategory === 'cloud' ? 'ready' : 'idle'
}

/** What the build is doing, in words. No time estimates: we cannot know them. */
function stateLine(inst: InstancePickerInstall, f: BuildMenuFacts, t: Translate): string {
  if (f.launching.has(inst.id)) return t('chooser.statusLaunching')
  if (f.running.has(inst.id)) return t('chooser.statusRunning')
  if (inst.sourceCategory === 'cloud') return t('buildsDashboard.status.ready')
  return t('buildsDashboard.status.notRunning')
}

/** "5m ago", "3d ago", or a date past a month; empty when never used. */
function lastUsed(at: number | undefined, t: Translate): string {
  return at ? formatRelativeFromMs(at, t) : ''
}

/** Where a build lives: its folder (home shown as ~), Comfy Cloud's host, or
 *  the remote server it connects to. */
function locationOf(inst: InstancePickerInstall, f: BuildMenuFacts): string {
  if (inst.sourceCategory === 'cloud') return f.cloudHost
  // A remote build's server, without the scheme.
  if (inst.sourceCategory === 'remote') {
    return typeof inst.remoteUrl === 'string' ? inst.remoteUrl.replace(/^https?:\/\//, '') : ''
  }
  const home = os.homedir()
  const folder = inst.installPath ?? ''
  const inHome = folder === home || folder.startsWith(home + path.sep)
  return inHome ? `~${folder.slice(home.length)}` : folder
}

function switcherRow(inst: InstancePickerInstall, f: BuildMenuFacts, t: Translate): TitleMenuRow {
  const isCurrent = inst.id === f.currentId
  return {
    id: `${SWITCHER_OPEN_PREFIX}${inst.id}`,
    label: inst.name,
    icon: iconFor(inst),
    status: statusOf(inst, f),
    detail: stateLine(inst, f, t),
    meta: isCurrent ? t('titleBar.switcher.current') : lastUsed(inst.lastLaunchedAt, t),
    checked: isCurrent
  }
}

/** The switcher: All builds, the builds with a window open, the others by
 *  last use, then Manage builds. */
export function buildSwitcherRows(f: BuildMenuFacts, t: Translate): TitleMenuRow[] {
  const open = f.installs.filter((inst) => f.withWindow.has(inst.id))
  const others = f.installs
    .filter((inst) => !f.withWindow.has(inst.id))
    .sort((a, b) => (b.lastLaunchedAt ?? 0) - (a.lastLaunchedAt ?? 0))
  const section = (heading: string, installs: InstancePickerInstall[]): TitleMenuRow[] =>
    installs.length
      ? [{ kind: 'heading', label: heading }, ...installs.map((i) => switcherRow(i, f, t))]
      : []
  return [
    { id: SWITCHER_DASHBOARD, label: t('buildsDashboard.allBuilds'), icon: 'builds' },
    ...section(t('titleBar.switcher.open'), open),
    ...section(t('titleBar.switcher.recent'), others),
    SEPARATOR,
    { id: SWITCHER_MANAGE, label: t('titleBar.switcher.manage'), icon: 'settings' }
  ]
}

/** A build's info card: what it is, where it lives, its state, and the
 *  actions that used to sit behind the centre pill. */
export function buildInfoRows(
  inst: InstancePickerInstall,
  f: BuildMenuFacts,
  t: Translate
): TitleMenuRow[] {
  const status = statusOf(inst, f)
  const location = locationOf(inst, f)
  const used = lastUsed(inst.lastLaunchedAt, t)
  const fact = (icon: TitleMenuIcon, label: string, meta: string): TitleMenuRow => ({
    kind: 'info',
    icon,
    label,
    meta
  })
  return [
    { kind: 'title', label: inst.name, icon: iconFor(inst), status, detail: inst.sourceLabel },
    SEPARATOR,
    { ...fact('status', t('titleBar.info.status'), stateLine(inst, f, t)), status },
    ...(inst.version ? [fact('version', 'ComfyUI', inst.version)] : []),
    ...(location ? [fact('folder', t('titleBar.info.location'), location)] : []),
    ...(used ? [fact('clock', t('titleBar.info.lastUsed'), used)] : []),
    ...(inst.statusTag?.style === 'update'
      ? [fact('update', t('titleBar.info.update'), inst.statusTag.label)]
      : []),
    SEPARATOR,
    { id: INFO_SETTINGS, label: t('titleBar.info.settings'), icon: 'settings' },
    ...(inst.sourceCategory === 'local' && inst.installPath
      ? [{ id: INFO_FOLDER, label: t('titleBar.info.openFolder'), icon: 'folder' as const }]
      : []),
    { id: INFO_CLOSE, label: t('titleBar.info.closeWindow'), icon: 'close' }
  ]
}
