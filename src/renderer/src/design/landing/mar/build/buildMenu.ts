import { shallowReactive } from 'vue'
import {
  ArrowUpCircle,
  CloudUpload,
  CircleStop,
  Copy,
  Download,
  FolderOpen,
  History,
  Play,
  Power,
  PowerOff,
  RotateCw,
  ScrollText,
  Settings2,
  Trash2,
  X
} from 'lucide-vue-next'
import { proto, toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import { envKind } from '../../parts/env/env'
import type { MenuAction, MenuLine } from '../pages/menu'
import { openBuild } from './buildTab'
import { BUILD_NAME, flow, showInstall } from '../setup/setupFlow'
import {
  autoStart,
  cancelRun,
  hasUpdate,
  nowOf,
  restartBuild,
  startBuild,
  stopBuild,
  uninstallBuild,
  viewLogs,
  type BuildNow
} from './homeRun'

/**
 * A build's one menu: its ⋯ on a Home tile, a right-click on the tile and a
 * right-click on its sidebar row (Desktop's BuildMenu / useBuildMenu). What
 * you can do now first, then Auto start, then the rest (Upload build after
 * Restore snapshot, when signed in), Uninstall last, asking inside the
 * menu. A line that can't run now stays, greyed. No Open in new window:
 * every build opens in its own window (Comfy-Desktop#2147).
 */
export interface BuildMenuTarget {
  name: string
  local: boolean
  now: BuildNow
  update?: boolean
  launch: () => void
  autoStart?: boolean
  toggleAutoStart?: () => void
  viewLogs: () => void
  cancel: () => void
  restart?: () => void
  stop?: () => void
  manage: () => void
  restore: () => void
  uninstall: () => void
}

const sep = 'sep' as const

export function buildMenuLines(t: BuildMenuTarget): MenuLine[] {
  const busy = t.now === 'starting' || t.now === 'installing' || t.now === 'uninstalling'
  const running = t.now === 'running'
  const why = busy ? 'Wait until it finishes.' : running ? 'Stop the running build first.' : ''
  const gated = { disabled: busy || running, title: why || undefined }
  const now: MenuAction[] =
    t.now === 'ready'
      ? [{ label: 'Start', icon: Play, run: t.launch }]
      : t.now === 'running'
        ? [
            { label: 'View logs', icon: ScrollText, run: t.viewLogs },
            { label: 'Restart', icon: RotateCw, run: t.restart },
            { label: 'Stop', icon: CircleStop, run: t.stop }
          ]
        : t.now === 'uninstalling'
          ? [{ label: 'Cancel', icon: X, run: t.cancel }]
          : [
              { label: 'View logs', icon: ScrollText, run: t.viewLogs },
              { label: 'Cancel', icon: X, run: t.cancel }
            ]
  const rest: MenuAction[] = [
    {
      label: 'Manage',
      icon: Settings2,
      run: t.manage,
      disabled: busy,
      title: busy ? why : undefined
    },
    ...(t.update ? [{ label: 'Update', icon: ArrowUpCircle, run: t.manage, ...gated }] : []),
    ...(t.local
      ? [
          {
            label: 'Duplicate',
            icon: Copy,
            run: () => toast(`Duplicating ${t.name}`),
            ...gated
          },
          {
            label: 'Show in Finder',
            icon: FolderOpen,
            run: () => toast(`Revealed ${t.name}`),
            disabled: t.now === 'installing' || t.now === 'uninstalling'
          }
        ]
      : [])
  ]
  const snaps: MenuAction[] = t.local
    ? [
        {
          label: 'Export snapshot',
          icon: Download,
          run: () => toast('Snapshot exported.'),
          disabled: busy,
          title: busy ? why : undefined
        },
        { label: 'Restore snapshot', icon: History, run: t.restore, ...gated },
        // Signed in to a workspace, a finished build can go to the
        // Developer Platform (Comfy-Desktop#2174).
        ...(proto.signedIn && t.now !== 'installing'
          ? [
              {
                label: 'Upload build',
                icon: CloudUpload,
                title: 'Upload this build to Comfy Developer Platform.',
                run: () => toast(`Uploading ${t.name}`),
                disabled: busy
              }
            ]
          : [])
      ]
    : []
  const auto: MenuAction[] =
    t.local && t.toggleAutoStart && t.now !== 'installing'
      ? [
          {
            label: t.autoStart ? 'Turn off Auto start' : 'Auto start',
            icon: t.autoStart ? PowerOff : Power,
            run: t.toggleAutoStart
          }
        ]
      : []
  const end: MenuAction[] = t.local
    ? [
        {
          label: 'Uninstall',
          icon: Trash2,
          danger: true,
          run: t.uninstall,
          ...gated,
          confirm: {
            text: 'This permanently removes this ComfyUI installation and all its files. This cannot be undone.',
            yes: 'Uninstall'
          }
        }
      ]
    : []
  return [
    ...now,
    ...(auto.length ? [sep, ...auto] : []),
    sep,
    ...rest,
    ...(snaps.length ? [sep, ...snaps] : []),
    ...(end.length ? [sep, ...end] : [])
  ]
}

/** A build in the list (Home's row, the sidebar), as the menu sees it. */
export function instanceTarget(i: ProtoInstance): BuildMenuTarget {
  return {
    name: i.name,
    local: envKind(i) === 'local',
    now: nowOf(i),
    update: hasUpdate(i),
    launch: () => startBuild(i),
    autoStart: autoStart.id === i.id,
    toggleAutoStart: () => (autoStart.id = autoStart.id === i.id ? '' : i.id),
    // Starting: the start's own logs; running: the build's Terminal.
    viewLogs: () => (nowOf(i) === 'running' ? openBuild(i.id, 'terminal') : viewLogs(i)),
    cancel: () => cancelRun(i),
    restart: () => restartBuild(i),
    stop: () => stopBuild(i),
    manage: () => openBuild(i.id),
    restore: () => openBuild(i.id, 'snapshots'),
    uninstall: () => uninstallBuild(i)
  }
}

export const instanceMenu = (i: ProtoInstance): MenuLine[] => buildMenuLines(instanceTarget(i))

/** A build menu opened at the pointer (a right-click on a sidebar row). */
export const pointMenu = shallowReactive({
  open: false,
  x: 0,
  y: 0,
  lines: [] as MenuLine[]
})

export function openMenuAt(e: MouseEvent, lines: () => MenuLine[]): void {
  e.preventDefault()
  pointMenu.x = e.clientX
  pointMenu.y = e.clientY
  pointMenu.lines = lines()
  pointMenu.open = true
}

/** The first build while it installs (the Home's install tile, its sidebar
 *  row): View logs and Cancel, the rest greyed until it is there. */
export function installingMenu(): MenuLine[] {
  const none = (): void => {}
  return buildMenuLines({
    name: flow.another ? flow.buildName : BUILD_NAME,
    local: true,
    now: 'installing',
    launch: none,
    viewLogs: showInstall,
    cancel: () => (flow.confirmCancel = true),
    manage: none,
    restore: none,
    uninstall: none
  })
}
