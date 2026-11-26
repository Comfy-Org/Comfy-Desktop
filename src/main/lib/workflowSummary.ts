import type { AssetWorkflowSummary } from '../../types/ipc'
import type { EmbeddedWorkflow } from './embeddedWorkflow'

const MODEL_FILE = /\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx)$/i
const PROMPT_NODE_TYPE = /clip ?text ?encode|text ?encode|prompt|wildcard/i
const PROMPT_INPUT_KEY = /^(text|text_g|text_l|prompt|positive|negative|string)$/i
const MAX_MODELS = 10
const MAX_PROMPTS = 6
const MAX_PROMPT_CHARS = 2000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const DISK_PATH = /^(\/|~[\\/]|[a-z]:[\\/]|\\\\)/i

function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

function modelName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!MODEL_FILE.test(name)) return null
  return DISK_PATH.test(name) ? fileName(name) : name
}

function promptText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || MODEL_FILE.test(text)) return null
  return text.length > MAX_PROMPT_CHARS ? `${text.slice(0, MAX_PROMPT_CHARS)}…` : text
}

function widgetValues(node: Record<string, unknown>): unknown[] {
  const values = node['widgets_values']
  if (Array.isArray(values)) return values
  return isRecord(values) ? Object.values(values) : []
}

function graphNodes(data: Record<string, unknown>): Record<string, unknown>[] {
  const nodes = data['nodes']
  return Array.isArray(nodes) ? nodes.filter(isRecord) : []
}

function fromGraph(data: Record<string, unknown>, found: Collected): void {
  for (const node of graphNodes(data)) {
    const type = typeof node['type'] === 'string' ? node['type'] : ''
    const prompts = PROMPT_NODE_TYPE.test(type)
    for (const value of widgetValues(node)) {
      found.model(modelName(value))
      if (prompts) found.prompt(promptText(value))
    }
  }
}

function fromApi(data: Record<string, unknown>, found: Collected): void {
  for (const node of Object.values(data)) {
    if (!isRecord(node)) continue
    const inputs = node['inputs']
    if (!isRecord(inputs)) continue
    for (const [key, value] of Object.entries(inputs)) {
      found.model(modelName(value))
      if (PROMPT_INPUT_KEY.test(key)) found.prompt(promptText(value))
    }
  }
}

interface Collected {
  model: (name: string | null) => void
  prompt: (text: string | null) => void
}

function collector(models: Set<string>, prompts: Set<string>): Collected {
  return {
    model: (name) => {
      if (name && models.size < MAX_MODELS) models.add(name)
    },
    prompt: (text) => {
      if (text && prompts.size < MAX_PROMPTS) prompts.add(text)
    }
  }
}

export function summarizeWorkflow(workflow: EmbeddedWorkflow): AssetWorkflowSummary {
  const models = new Set<string>()
  const prompts = new Set<string>()
  const found = collector(models, prompts)
  if (workflow.format === 'graph') fromGraph(workflow.data, found)
  else fromApi(workflow.data, found)
  return { models: [...models], prompts: [...prompts] }
}
