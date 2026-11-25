import { reactive } from 'vue'
import type { NodeKind, Recipe } from './canvasData'
import type { AppGraph } from '../apps/appToComfy'

export interface AgentStart {
  ask: string
  reply: string
  recipe: Recipe
  steps: string[]
  result: string
}

export interface GraphTemplate {
  title: string
  model: string
  prompt: string
  output: string
  input?: string
  video: boolean
  tabId?: string
}

/** What ComfyUI opens with when a share link asks for it (?comfy=assets,
 *  tab or inspect): the Media Assets panel, expanded to a tab, and the
 *  first asset in Inspect asset. Read once, then cleared. */
export const graphOpen = reactive({
  assets: false,
  tab: false,
  inspect: false,
  scratch: false,
  start: null as null | { kind: NodeKind; model?: string },
  recipe: null as null | Recipe,
  agent: false,
  agentAsk: null as null | AgentStart,
  nodeSearch: false,
  template: null as null | GraphTemplate,
  app: null as null | AppGraph,
  /** Assets › Open workflow: ComfyUI opens with this one on the canvas,
   *  on the workflow's output (MarGraph's landAsset). */
  select: null as null | {
    id: string
    name: string
    src?: string
    clip?: string
    type: string
  }
})
