import { reactive, watch } from 'vue'
import { closeTab, instanceById, proto, toast } from './useProto'

/**
 * In the app, with "Data: Mine": a build's tab shows its real ComfyUI. Main
 * keeps one ComfyUI view per open tab under the title bar
 * (comfy-design:show-build); Home hides them to show the launcher. Opening a
 * tab starts the build if it isn't running; closing the tab stops it again
 * if this launcher started it.
 *
 * The launcher page shows under the view: ComfyTab says what's happening
 * while it starts, or why it couldn't.
 */
export type BuildState =
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

/** Per build (installation) id. */
export const buildState = reactive<Record<string, BuildState>>({})

/** Builds this launcher started, so closing their tab stops them. */
const started = new Set<string>()

async function show(): Promise<void> {
  const tab = proto.tabs.find((t) => t.id === proto.activeTab)
  const id = tab && proto.live && instanceById(tab.instanceId)?.source ? tab.instanceId : null
  const shown = await window.api.designShowBuild(id)
  if (!id || shown.ok) {
    if (id) buildState[id] = { kind: 'ready' }
    return
  }
  if (shown.reason !== 'not-running' || buildState[id]?.kind === 'starting') return
  // Not running: show Home underneath while it starts, then the build.
  await window.api.designShowBuild(null)
  buildState[id] = { kind: 'starting' }
  const result = await window.api.runAction(id, 'launch', {
    launchModeOverride: 'console',
    autoPortOnConflict: true
  })
  if (!result.ok) {
    buildState[id] = {
      kind: 'error',
      message: result.cancelled ? 'Start was cancelled.' : (result.message ?? 'It did not start.')
    }
    return
  }
  started.add(id)
  delete buildState[id]
  // Still in front? Show it now.
  if (proto.tabs.find((t) => t.id === proto.activeTab)?.instanceId === id) await show()
}

/**
 * Open a build in its own window (Milestones 3-6, and "Open in a new window"
 * in 7). The app's normal launch does that from here: with no claim on this
 * window, it opens a new one. If it's open here, its tab goes first - and if this
 * launcher started it, it stops and starts again in the new window.
 */
export async function openInNewWindow(id: string): Promise<void> {
  const inst = instanceById(id)
  if (!inst) return
  if (!proto.live || !inst.source) {
    toast(`${inst.name} opens in its own window`)
    return
  }
  // Already running in a window of its own: bring that window forward.
  if (inst.state === 'running' && (await window.api.focusComfyWindow(id))) return
  const tab = proto.tabs.find((t) => t.instanceId === id)
  if (tab) {
    // Take it off the list first so closing the tab doesn't stop it too.
    const ours = started.delete(id)
    closeTab(tab.id)
    await window.api.designCloseBuild(id)
    if (ours) await window.api.stopComfyUI(id)
  }
  const result = await window.api.runAction(id, 'launch')
  if (!result.ok && !result.cancelled) toast(result.message ?? `Couldn't open ${inst.name}`)
}

/** Inside the app: follow the tabs. */
export function connectBuildTabs(): void {
  watch(
    () => [proto.activeTab, proto.live],
    () => void show(),
    { immediate: true }
  )
  watch(
    () => proto.tabs.map((t) => t.instanceId),
    (now, before) => {
      for (const id of before ?? []) {
        if (now.includes(id)) continue
        void window.api.designCloseBuild(id)
        delete buildState[id]
        if (started.delete(id)) void window.api.stopComfyUI(id)
      }
    }
  )
}
