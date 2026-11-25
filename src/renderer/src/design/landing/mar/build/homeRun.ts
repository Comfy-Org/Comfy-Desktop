import { reactive } from 'vue'
import { hostActions } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import { envKind } from '../../parts/env/env'

/**
 * What a build on the Home is doing now, in memory: starting (with its
 * steps and log) or uninstalling, and what was started or stopped here. A
 * start runs on the tile, then opens ComfyUI, as Desktop does.
 */
export type BuildNow = 'ready' | 'starting' | 'installing' | 'running' | 'updating' | 'uninstalling'

interface Run {
  kind: 'start' | 'update' | 'uninstall'
  percent: number
}

export const runs = reactive(new Map<string, Run>())
/** Started or stopped from the Home: wins over the mock's state. */
const settled = reactive(new Map<string, 'running' | 'stopped'>())
/** Uninstalled from the Home: gone from its row and the sidebar. */
export const uninstalled = reactive(new Set<string>())
/** The build that starts when Desktop opens (Auto start), one at most. */
export const autoStart = reactive({ id: '' })
/** Updated from the Home: no update waiting any more. */
export const updated = reactive(new Set<string>())
/** The build whose logs are open (BuildLogs.vue): a start's steps and log,
 *  or a running build's ComfyUI output (`running`). */
export const logs = reactive({ id: '', running: false })

const timers = new Map<string, ReturnType<typeof setInterval>>()

// A start's steps, as Desktop names them (installProgress.stepName).
export const START_STEPS = [
  { until: 12, label: 'Start ComfyUI' },
  { until: 26, label: 'Run security scan' },
  { until: 44, label: 'Load libraries' },
  { until: 60, label: 'Initialize GPU' },
  { until: 86, label: 'Load custom nodes' },
  { until: 100, label: 'Start server' }
] as const
// What ComfyUI prints on the way, one line at a time.
export const START_LOG: { at: number; text: string }[] = [
  { at: 0, text: '[START] Security scan' },
  { at: 4, text: 'Checkpoint files will always be loaded safely.' },
  { at: 14, text: '[DONE] Security scan' },
  { at: 18, text: 'ComfyUI-Manager: installing dependencies done.' },
  { at: 28, text: '** ComfyUI startup time: 2026-11-15 10:42:07.412' },
  { at: 32, text: '** Platform: Darwin' },
  { at: 36, text: '** Python version: 3.12.9' },
  { at: 40, text: 'Prestartup times for custom nodes: 0.0 seconds' },
  { at: 46, text: 'Total VRAM 24576 MB, total RAM 65536 MB' },
  { at: 50, text: 'pytorch version: 2.7.1' },
  { at: 54, text: 'Set vram state to: SHARED' },
  { at: 58, text: 'Device: mps' },
  { at: 62, text: 'Using sub quadratic optimization for attention' },
  { at: 66, text: '### Loading: ComfyUI-Manager (V4.0)' },
  { at: 70, text: '[ComfyUI-Manager] network_mode: private' },
  { at: 74, text: 'Import times for custom nodes:' },
  { at: 78, text: '   0.0 seconds: custom_nodes/websocket_image_save.py' },
  { at: 82, text: '   0.4 seconds: custom_nodes/ComfyUI-KJNodes' },
  { at: 88, text: 'Starting server' },
  { at: 96, text: 'To see the GUI go to: http://127.0.0.1:8188' }
]

// An update's steps (Desktop's update progress) and what it prints.
export const UPDATE_STEPS = [
  { until: 15, label: 'Save a snapshot' },
  { until: 55, label: 'Get the new ComfyUI' },
  { until: 90, label: 'Update packages' },
  { until: 100, label: 'Finish' }
] as const
export const UPDATE_LOG: { at: number; text: string }[] = [
  { at: 0, text: 'Saving snapshot before update…' },
  { at: 12, text: 'Snapshot saved: 2026-11-18_10-42-07.json' },
  { at: 18, text: 'git fetch --tags origin' },
  { at: 34, text: 'git checkout v0.3.75' },
  { at: 56, text: 'Installing requirements.txt' },
  { at: 70, text: 'Successfully installed comfyui-frontend-package-1.30.6' },
  { at: 92, text: 'Update finished.' }
]

const local = (i: ProtoInstance): boolean => envKind(i) === 'local'

export function nowOf(i: ProtoInstance): BuildNow {
  const run = runs.get(i.id)
  if (run)
    return run.kind === 'start' ? 'starting' : run.kind === 'update' ? 'updating' : 'uninstalling'
  if (!local(i)) return 'ready'
  const state = settled.get(i.id) ?? (i.state === 'running' ? 'running' : 'stopped')
  return state === 'running' ? 'running' : 'ready'
}

function tick(id: string, ms: number, done: () => void): void {
  clearInterval(timers.get(id))
  timers.set(
    id,
    setInterval(() => {
      const run = runs.get(id)
      if (!run) return clearInterval(timers.get(id))
      run.percent = Math.min(100, run.percent + 1)
      if (run.percent < 100) return
      clearInterval(timers.get(id))
      runs.delete(id)
      done()
    }, ms)
  )
}

/** Launch: a build on this computer starts on its tile, then opens. */
export function startBuild(i: ProtoInstance): void {
  if (runs.has(i.id)) return
  if (nowOf(i) === 'running' || !local(i)) return hostActions.launch(i)
  runs.set(i.id, { kind: 'start', percent: 0 })
  tick(i.id, 70, () => {
    settled.set(i.id, 'running')
    if (logs.id === i.id) logs.id = ''
    hostActions.launch(i)
  })
}

export function stopBuild(i: ProtoInstance): void {
  settled.set(i.id, 'stopped')
}

export function restartBuild(i: ProtoInstance): void {
  stopBuild(i)
  startBuild(i)
}

/** Cancel a start or an uninstall: the build is as it was. */
export function cancelRun(i: ProtoInstance): void {
  clearInterval(timers.get(i.id))
  runs.delete(i.id)
  if (logs.id === i.id) logs.id = ''
}

export function uninstallBuild(i: ProtoInstance): void {
  settled.set(i.id, 'stopped')
  runs.set(i.id, { kind: 'uninstall', percent: 0 })
  tick(i.id, 30, () => uninstalled.add(i.id))
}

/** Whether an update is waiting on this build. */
export const hasUpdate = (i: ProtoInstance): boolean => i.state === 'update' && !updated.has(i.id)

/** Update runs on the build itself (Comfy-Desktop#2216): the tile, the
 *  sidebar row and the build page show "Updating · N%"; you stay where you
 *  are. No full-screen loader. */
export function updateBuild(i: ProtoInstance): void {
  if (runs.has(i.id)) return
  runs.set(i.id, { kind: 'update', percent: 0 })
  tick(i.id, 60, () => updated.add(i.id))
}

/** View logs: a start shows its steps and log; a running build opens its
 *  ComfyUI log window, everything printed since it started and the new
 *  lines as they come (Comfy-Desktop#2213), never the Terminal. */
export function viewLogs(i: ProtoInstance): void {
  logs.running = nowOf(i) === 'running' || runs.get(i.id)?.kind === 'update'
  logs.id = i.id
}
