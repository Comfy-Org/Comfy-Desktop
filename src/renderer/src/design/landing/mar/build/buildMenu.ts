import { shallowReactive } from 'vue'
import {
  AppWindow,
  ArrowUpCircle,
  CircleStop,
  Copy,
  Download,
  FolderOpen,
  History,
  Play,
  RotateCw,
  ScrollText,
  Settings2,
  Trash2,
  X
} from 'lucide-vue-next'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import { envKind } from '../../parts/env/env'
import type { MenuAction, MenuLine } from '../pages/menu'
import { openBuild } from './buildTab'
import { BUILD_NAME, flow, showInstall } from '../setup/setupFlow'
import {
  cancelRun,
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
 * you can do now first, then Open in new window, then the rest, Uninstall
 * last, asking inside the menu. A line that can't run now stays, greyed.
 */
export interface BuildMenuTarget {
  name: string
  local: boolean
  now: BuildNow
  update?: boolean
  launch: () => void
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
  const why = busy ? 'Wait until it finishes.' : running ? 'Stop the running instance first.' : ''
  const gated = { disabled: busy || running, title: why || undefined }
  const now: MenuAction[] =
    t.now === 'ready'
      ? [{ label: 'Launch', icon: Play, run: t.launch }]
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
        { label: 'Restore snapshot', icon: History, run: t.restore, ...gated }
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
    ...(busy
      ? []
      : [
          sep,
          {
            label: 'Open in new window',
            icon: AppWindow,
            run: () => toast(`Opening ${t.name} in a new window`)
          }
        ]),
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
    update: i.state === 'update',
    launch: () => startBuild(i),
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
