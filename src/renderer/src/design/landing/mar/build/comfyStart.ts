import { reactive } from 'vue'

export type BuildStartScenario = 'starts' | 'fails' | 'crashes'

export const BUILD_STARTS: { value: BuildStartScenario; label: string }[] = [
  { value: 'starts', label: 'Starts' },
  { value: 'fails', label: "Doesn't start" },
  { value: 'crashes', label: 'Exits while starting' }
]

export const buildStart = reactive<{ id: BuildStartScenario }>({ id: 'starts' })

export const START_COPY = {
  title: 'Starting ComfyUI…',
  homeStatus: 'Starting…',
  process: 'Starting ComfyUI process…',
  waiting: (secs: number): string => `Waiting for ComfyUI to be ready… (${secs}s)`,
  cancel: 'Cancel',
  viewLogs: 'View logs',
  cancelled: 'Launch cancelled.',
  failedTitle: 'ComfyUI could not start',
  crashedTitle: 'ComfyUI exited unexpectedly',
  restart: 'Restart ComfyUI',
  backToHome: 'Back to Home',
  didntStart: "Didn't start",
  crashed: 'Crashed',
  clickToViewLogs: 'Click to view logs'
} as const

export const START_ACTIVITY: { from: number; text: string }[] = [
  { from: 20, text: 'Loading ComfyUI-Manager…' },
  { from: 45, text: 'Configuring GPU memory…' },
  { from: 60, text: 'Optimizing for your hardware…' },
  { from: 72, text: 'Loading custom nodes…' },
  { from: 88, text: 'Preparing model loading…' }
]

export const activityAt = (percent: number): string | undefined =>
  [...START_ACTIVITY].reverse().find((a) => percent >= a.from)?.text

export interface StartFailure {
  kind: 'didnt-start' | 'crashed' | 'cannot-connect'
  title: string
  message: string
}

export const startFailures = reactive(new Map<string, StartFailure>())

export const START_FAIL_AT = 64

export function failureFor(scenario: BuildStartScenario): StartFailure | undefined {
  if (scenario === 'fails')
    return {
      kind: 'didnt-start',
      title: START_COPY.failedTitle,
      message:
        "Another ComfyUI is using this build's database, so this one could not start. Close the other ComfyUI, or the app that started it, and try again."
    }
  if (scenario === 'crashes')
    return {
      kind: 'crashed',
      title: START_COPY.crashedTitle,
      message:
        'The ComfyUI process exited (exit code 1). You can restart it below. See the logs for details.'
    }
  return undefined
}
