import { reactive } from 'vue'
import type { Template } from '../../mock'
import type { ModelReq } from '../../fit'
import { instanceById } from '../../useProto'
import { isDownloaded } from '../templateOpen/installed'
import { downloadFor, startDownload } from '../downloads/templateDownloads'
import { SAVED_MISSING_FROM, needsFor, tplById } from '../templateModal/templateData'

export const MISSING_MODELS_COPY = {
  title: 'This workflow is missing models',
  description: "This workflow requires models you haven't downloaded yet.",
  totalSize: 'Total download size:',
  downloadAll: 'Download all',
  gotIt: 'Open anyway',
  notDownloadable: 'Not downloadable',
  notDownloadableHint:
    "Some models can't download on their own. Find them online, or import a file you already have.",
  findIt: 'Find it',
  haveIt: 'I have it',
  imported: 'Imported',
  missingOnNode: (name: string): string => `Missing model: ${name}. Find it or import it to run.`,
  footer:
    'Download and place these models in the correct folder. Nodes with missing models are highlighted red on the canvas.'
}

export interface MissingModels {
  template: Template
  models: ModelReq[]
  manual: ModelReq[]
}

export const manualModels = reactive({ on: false, imported: new Set<string>() })

const MANUAL: Record<string, ModelReq[]> = {
  'krea-street': [{ name: 'street_grain_lora_v2.safetensors', size: '228 MB', gb: 0.22 }]
}

export const manualFor = (workflow: string): ModelReq[] =>
  manualModels.on ? (MANUAL[workflow] ?? []) : []

export const unresolvedManual = (workflow: string): ModelReq[] =>
  manualFor(workflow).filter((m) => !manualModels.imported.has(m.name))

const seen = reactive(new Set<string>())

const keyOf = (tabId: string, workflow: string): string => `${tabId}:${workflow}`

export function missingModelsOn(
  tabId: string,
  workflow: string,
  instId: string
): MissingModels | undefined {
  const from = SAVED_MISSING_FROM[workflow]
  const template = from ? tplById(from) : undefined
  if (!template || seen.has(keyOf(tabId, workflow))) return undefined
  if (instanceById(instId)?.kind !== 'local' || isDownloaded(template.id, instId)) return undefined
  const live = downloadFor(template.id)
  if (live && live.status !== 'cancelled') return undefined
  return { template, models: needsFor(template), manual: manualFor(workflow) }
}

export function closeMissingModels(tabId: string, workflow: string): void {
  seen.add(keyOf(tabId, workflow))
}

export function downloadMissingModels(
  tabId: string,
  workflow: string,
  instId: string,
  template: Template
): void {
  const inst = instanceById(instId)
  closeMissingModels(tabId, workflow)
  if (inst) startDownload(template, inst, { opens: false })
}

export function modelFolder(name: string): string {
  if (/vae/i.test(name)) return 'VAE'
  if (/clip|text_encoder|t5|qwen_2|umt5/i.test(name)) return 'TEXT ENCODER'
  if (/lora/i.test(name)) return 'LORA'
  return 'DIFFUSION'
}
