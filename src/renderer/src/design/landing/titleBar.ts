import { computed, reactive, watch } from 'vue'
import { closeTab, go, goIn, hostActions, instanceById, instances, proto, toast } from './useProto'
import type { ProtoInstance } from './mock'
import {
  TITLEBAR_COMMAND_KEY,
  TITLEBAR_STATE_KEY,
  type TitleBarCommand,
  type TitleBarState
} from './titleBarBridge'
import { prototypeGroups, setPrototypeOption } from './prototypeOptions'
import { buildState, openInNewWindow } from './buildTabs'
import { can, landingPage } from './milestones'
import { appsProto, closeAppTab, libApp } from './appFlow'
import { thumb } from './mock'
import { marTabsOn } from './mar/shell/titleTabs'
import { buildTrail } from './mar/build/buildNav'
import { onCloud } from './mar/shell/surface'

/**
 * The launcher page's side of the title-bar breadcrumb (titleBarBridge.ts):
 * what the bar shows and what its clicks do. One open build is in front at
 * a time; ComfyUI keeps its own workflow tabs inside.
 */

// Opening a build brings it in front of any app tab.
watch(
  () => proto.activeTab,
  (id) => {
    if (id !== 'home') appsProto.front = ''
  }
)

// The build in front is the one Home runs on next.
watch(
  () => proto.activeTab,
  (id) => {
    const tab = proto.tabs.find((t) => t.id === id)
    if (tab) proto.activeInstanceId = tab.instanceId
  }
)

/** The build switcher in the browser preview's stand-in (SwitcherMenu.vue);
 *  in the app the real title bar shows it as a popup (TitleBarApp). */
export const switcherMenu = reactive({ open: false, left: 0, width: 0 })
// A click on the chevron while the menu is open first closes it as an
// outside click; don't reopen it right after.
let closedAt = 0
watch(
  () => switcherMenu.open,
  (open) => {
    if (!open) closedAt = Date.now()
  }
)

/** Where a build lives, short: its folder (home as ~) or its host. */
function locationOf(i: ProtoInstance): string | undefined {
  const source = i.source as { installPath?: string; remoteUrl?: string } | undefined
  if (source?.installPath) return source.installPath.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~')
  if (i.kind === 'cloud') return 'cloud.comfy.org'
  return undefined
}

const frontTab = computed(() => proto.tabs.find((t) => t.id === proto.activeTab))

export const titleBarState = computed<TitleBarState>(() => ({
  milestone: proto.milestone,
  home: proto.activeTab === 'home' && !appsProto.front,
  menuOpen: switcherMenu.open,
  front: frontTab.value
    ? {
        id: frontTab.value.instanceId,
        name: frontTab.value.title,
        kind: instanceById(frontTab.value.instanceId)?.kind === 'cloud' ? 'cloud' : 'local'
      }
    : null,
  builds: [...instances.value]
    .sort((a, b) => a.lastUsedRank - b.lastUsedRank)
    .map((i) => {
      const open = proto.tabs.some((t) => t.instanceId === i.id)
      const run = buildState[i.id]?.kind
      return {
        id: i.id,
        name: i.name,
        kind: i.kind === 'cloud' ? ('cloud' as const) : ('local' as const),
        open,
        status:
          run === 'starting' || run === 'error'
            ? run
            : open
              ? ('open' as const)
              : i.state === 'running'
                ? ('running' as const)
                : ('stopped' as const),
        lastUsed: i.lastUsed,
        source: i.kind === 'cloud' ? 'Comfy Cloud' : i.channel,
        version: i.version,
        location: locationOf(i),
        update: i.state === 'update' ? 'Update available' : undefined
      }
    }),
  apps: (can.value.exploreApps ? appsProto.tabs : []).flatMap((id) => {
    const app = libApp(id)
    return app ? [{ id, name: app.name, thumb: thumb(app.thumbId) }] : []
  }),
  appFront: appsProto.front || null,
  // Mar's tabs title bar (mar/shell/titleTabs.ts): only while it's on.
  ...(marTabsOn.value ? marTabs() : {}),
  // Mar's page trail (mar/build/buildNav.ts): only while it's on.
  ...(buildTrail.value ? { trail: buildTrail.value } : {}),
  ...(onCloud.value ? { noSwitcher: true } : {}),
  options: prototypeGroups.value.map((g) => ({
    key: g.key,
    label: g.label,
    value: g.model.value,
    options: g.options
  }))
}))

const kindOf = (id: string): 'local' | 'cloud' =>
  instanceById(id)?.kind === 'cloud' ? 'cloud' : 'local'

/** What Mar's tabs title bar adds: each open workflow as a tab (named
 *  after the workflow - or its build while it is untitled, so two new tabs
 *  aren't both "Untitled workflow" - its build in the tooltip), where Home
 *  runs next, and whether the agent is open. */
function marTabs(): Pick<TitleBarState, 'tabs' | 'tabFront' | 'runsOn' | 'agent'> {
  const runs = instanceById(proto.activeInstanceId)
  return {
    tabs: proto.tabs.map((t) => ({
      id: t.id,
      name: t.workflow === 'Untitled workflow' ? t.title : t.workflow,
      build: t.title,
      kind: kindOf(t.instanceId)
    })),
    tabFront: appsProto.front ? null : proto.activeTab === 'home' ? null : proto.activeTab,
    runsOn: runs ? { name: runs.name, kind: kindOf(runs.id) } : undefined,
    agent: can.value.agent ? proto.mode === 'agent' && proto.activeTab === 'home' : undefined
  }
}

/** A pick in a title-bar menu (or ⌘⇧H inside ComfyUI): `home`,
 *  `manage`, `proto:<switch>:<value>`, `window:<build id>` (open it in its
 *  own window), `close:<id>` (close it here), `folder:<id>` (its install
 *  folder), `settings:<id>` (the app's Manage dialog for it), or a build id
 *  to open here / bring to the front. */
export function openFromMenu(id: string): void {
  if (id === 'home') {
    appsProto.front = ''
    return go(landingPage())
  }
  if (id === 'manage') return go('environments')
  if (id.startsWith('window:')) return void openInNewWindow(id.slice('window:'.length))
  if (id.startsWith('close:')) {
    const tab = proto.tabs.find((t) => t.instanceId === id.slice('close:'.length))
    if (tab) closeTab(tab.id)
    return
  }
  if (id.startsWith('folder:')) {
    const path = (instanceById(id.slice('folder:'.length))?.source as { installPath?: string })
      ?.installPath
    if (path) void window.api.openPath(path)
    return
  }
  // The app's own Manage dialog for the build (settings, updates, logs).
  if (id.startsWith('settings:'))
    return window.api.openInstancePicker({ installationId: id.slice('settings:'.length) })
  if (id.startsWith('proto:')) {
    const [, key = '', value = ''] = id.split(':')
    return setPrototypeOption(key, value)
  }
  const inst = instanceById(id)
  if (inst) hostActions.launch(inst)
}

export function runTitleBarCommand(cmd: TitleBarCommand): void {
  // Anything else clicked in the bar closes the switcher.
  if (cmd.type !== 'switcher') switcherMenu.open = false
  switch (cmd.type) {
    case 'home':
      appsProto.front = ''
      go(landingPage())
      break
    case 'app':
      appsProto.front = cmd.id
      break
    case 'closeApp':
      closeAppTab(cmd.id)
      break
    case 'tab':
      appsProto.front = ''
      proto.activeTab = cmd.id
      break
    case 'closeTab':
      closeTab(cmd.id)
      break
    case 'agent':
      appsProto.front = ''
      if (proto.mode === 'agent' && proto.activeTab === 'home') goIn('create', landingPage())
      else goIn('agent', 'agent')
      proto.activeTab = 'home'
      break
    case 'page':
      appsProto.front = ''
      go(cmd.page as Parameters<typeof go>[0])
      break
    case 'info':
      // The browser preview has no popup to show it in.
      if (cmd.phase === 'click') toast('Build info opens on hover in the app')
      break
    case 'switcher':
      if (Date.now() - closedAt < 200) return
      Object.assign(switcherMenu, { open: !switcherMenu.open, left: cmd.left, width: cmd.width })
      break
  }
}

/** In the app: publish to the real title bar and take its clicks. */
export function connectTitleBar(): void {
  watch(titleBarState, (s) => localStorage.setItem(TITLEBAR_STATE_KEY, JSON.stringify(s)), {
    immediate: true
  })
  window.addEventListener('storage', (e) => {
    if (e.key === TITLEBAR_COMMAND_KEY && e.newValue) runTitleBarCommand(JSON.parse(e.newValue))
  })
  window.api.onDesignMenuPick(openFromMenu)
}
