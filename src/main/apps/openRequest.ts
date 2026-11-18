export const MAX_WORKFLOW_BYTES = 1_000_000
const MAX_NODES = 500
const BUILD_ID = /^[A-Za-z0-9_-]{1,64}$/
const WORKFLOW_NAME = /^[\p{L}\p{N} .,()'&_-]{1,80}$/u
const CREDENTIAL_INPUT = /^(api_key_comfy_org|auth_token_comfy_org)$/i
export const DEFAULT_WORKFLOW_NAME = 'Comfy app'

export interface OpenRequest {
  prompt: Record<string, unknown>
  where: 'local' | 'cloud'
  name: string
  build?: string
}

export interface EditorWorkflowRequest {
  graph: Record<string, unknown>
  where: 'local' | 'cloud'
  name: string
  build?: string
}

export type WorkflowRequest = OpenRequest | EditorWorkflowRequest

export type OpenRefusal = 'not-a-workflow' | 'unknown-place' | 'unknown-build' | 'carries-keys'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNode(value: unknown): value is { class_type: string; inputs: Record<string, unknown> } {
  return (
    isRecord(value) &&
    typeof value['class_type'] === 'string' &&
    value['class_type'] !== '' &&
    isRecord(value['inputs'])
  )
}

function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return Infinity
  }
}

export function isApiWorkflow(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const nodes = Object.values(value)
  if (nodes.length < 1 || nodes.length > MAX_NODES) return false
  return nodes.every(isNode) && serializedBytes(value) <= MAX_WORKFLOW_BYTES
}

export function isEditorWorkflow(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return false
  const { nodes } = value
  return (
    nodes.length > 0 &&
    nodes.length <= MAX_NODES &&
    nodes.every(
      (node: unknown) => isRecord(node) && typeof node.type === 'string' && node.type !== ''
    )
  )
}

export function isBuildId(value: unknown): value is string {
  return typeof value === 'string' && BUILD_ID.test(value)
}

export function workflowName(value: unknown, fallback = DEFAULT_WORKFLOW_NAME): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  return WORKFLOW_NAME.test(name) ? name : fallback
}

function carriesCredentials(prompt: Record<string, unknown>): boolean {
  return Object.values(prompt).some(
    (node) => isNode(node) && Object.keys(node.inputs).some((input) => CREDENTIAL_INPUT.test(input))
  )
}

export function readOpenRequest(raw: unknown): OpenRequest | OpenRefusal {
  if (!isRecord(raw)) return 'not-a-workflow'
  const { prompt, where, name, build } = raw
  if (where !== 'local' && where !== 'cloud') return 'unknown-place'
  if (build !== undefined && (where !== 'local' || !isBuildId(build))) return 'unknown-build'
  if (!isApiWorkflow(prompt)) return 'not-a-workflow'
  if (carriesCredentials(prompt)) return 'carries-keys'
  return { prompt, where, name: workflowName(name), ...(build === undefined ? {} : { build }) }
}

const STALE_PAGE_MARK = '__comfyDesktopStalePage'

export type ComfyPageState = 'starting' | 'no-workflow' | 'ready'

const FIND_COMFY_APP =
  `var app=window.app||(window.comfyAPI&&window.comfyAPI.app&&window.comfyAPI.app.app);` +
  `var usable=!!app&&!!app.graph&&!!app.canvas&&typeof app.loadApiJson==='function';`

export const MARK_PAGE_STALE_SCRIPT = `window.${STALE_PAGE_MARK}=true`

export const COMFY_STATE_SCRIPT =
  `(function(){${FIND_COMFY_APP}` +
  `if(!usable||window.${STALE_PAGE_MARK})return 'starting';` +
  `var overlay=document.querySelector('[data-testid="app-loading-overlay"]');` +
  `if(overlay&&overlay.getAttribute('aria-busy')==='true')return 'starting';` +
  `var workspace=app.extensionManager;` +
  `if(!workspace)return 'ready';` +
  `if(workspace.spinner===true)return 'starting';` +
  `var workflows=workspace.workflow;` +
  `if(!workflows)return 'ready';` +
  `if(workflows.isBusy===true)return 'starting';` +
  `return workflows.activeWorkflow?'ready':'no-workflow'})()`

export function openWorkflowScript(request: OpenRequest): string {
  return (
    `(function(promptText,name){` +
    FIND_COMFY_APP +
    `if(!usable)return false;` +
    `return Promise.resolve(app.loadApiJson(JSON.parse(promptText),name))` +
    `.then(function(r){return r!==false},function(){return false});` +
    `})(${JSON.stringify(JSON.stringify(request.prompt))},${JSON.stringify(request.name)})`
  )
}

export function openEditorWorkflowScript(request: EditorWorkflowRequest): string {
  return (
    `(function(graphText,name){` +
    FIND_COMFY_APP +
    `if(!usable||typeof app.loadGraphData!=='function')return false;` +
    `return Promise.resolve(app.loadGraphData(JSON.parse(graphText),true,true,name))` +
    `.then(function(r){return r!==false},function(){return false});` +
    `})(${JSON.stringify(JSON.stringify(request.graph))},${JSON.stringify(request.name)})`
  )
}

export function isComfyPage(pageUrl: string, comfyUrl: string): boolean {
  try {
    const page = new URL(pageUrl)
    return /^https?:$/.test(page.protocol) && page.origin === new URL(comfyUrl).origin
  } catch {
    return false
  }
}
