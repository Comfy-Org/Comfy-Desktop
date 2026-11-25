import { reactive, watch } from 'vue'
import type { Field } from '../../appFlow'

export type AppToComfyExtras = 'off' | 'on'

export const APP_TO_COMFY_EXTRAS: { value: AppToComfyExtras; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' }
]

const KEY = 'comfy.design.mar.appToComfy'

export const appToComfy = reactive<{ id: AppToComfyExtras }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'on' ? 'on' : 'off'
    } catch {
      return 'off'
    }
  })()
})

watch(
  () => appToComfy.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      return
    }
  }
)

export const extrasOn = (): boolean => appToComfy.id === 'on'

export const OPEN_ERRORS = {
  noBuilds: 'Add a local build in Comfy Desktop to run apps on this computer.',
  couldNotStart: 'Comfy Desktop could not start {name}.',
  stillInstalling: '{name} is still installing. Try again once it finishes.',
  openNoCloud: 'Add Comfy Cloud in Comfy Desktop first.',
  openCloudFailed: 'Comfy Desktop could not open Comfy Cloud.',
  openNoWindow: 'Comfy Desktop could not show the ComfyUI window.',
  openNotTaken: 'ComfyUI did not open the workflow.',
  openNotWorkflow: 'This is not a workflow Comfy Desktop can open.',
  openUnknownPlace: 'Open it on Comfy Cloud or on this computer.',
  openUnknownBuild: 'That ComfyUI build is not on this computer.',
  openCarriesKeys: 'Comfy Desktop does not open a workflow that carries a Comfy key.'
} as const

export type OpenError = keyof typeof OPEN_ERRORS
export type OpenAnswer = 'auto' | OpenError

export const errorText = (e: OpenError, name = 'ComfyUI'): string =>
  OPEN_ERRORS[e].replace('{name}', name)

export const OPEN_ANSWERS: { value: OpenAnswer; label: string }[] = [
  { value: 'auto', label: 'Opens · as the builds are' },
  ...(Object.keys(OPEN_ERRORS) as OpenError[]).map((value) => ({
    value,
    label: errorText(value, 'My Local 1')
  }))
]

export const openAnswer = reactive<{ id: OpenAnswer }>({ id: 'auto' })

export const DEFAULT_WORKFLOW_NAME = 'Comfy app'
const WORKFLOW_NAME = /^[\p{L}\p{N} .,()'&_-]{1,80}$/u

export function workflowName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ')
  return WORKFLOW_NAME.test(name) ? name : DEFAULT_WORKFLOW_NAME
}

export interface AppGraphInput {
  label: string
  node: string
  kind: Field['kind']
  value?: string
}

export interface AppGraph {
  appId: string
  name: string
  video: boolean
  inputs: AppGraphInput[]
  image?: string
  prompt?: string
  seed: number
  output?: string
  filter?: string
  badges: boolean
}

export const copiedTabs = reactive<Record<string, boolean>>({})

export const copyName = (name: string): string => `Copy of ${name}`

export const newSeed = (): number => 100_000_000 + Math.floor(Math.random() * 899_999_999)

const pendingByTemplate = new Map<string, AppGraph>()

export function holdForDownload(templateId: string, graph: AppGraph): void {
  pendingByTemplate.set(templateId, graph)
}

export function takeHeld(templateId: string): AppGraph | undefined {
  const g = pendingByTemplate.get(templateId)
  pendingByTemplate.delete(templateId)
  return g
}
