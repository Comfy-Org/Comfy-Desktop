import { reactive } from 'vue'
import type { Template } from '../../mock'
import type { ModelReq } from '../../fit'
import { instanceById } from '../../useProto'
import { isDownloaded } from '../autorun/installed'
import { downloadFor, startDownload } from '../downloads/templateDownloads'
import { SAVED_MISSING_FROM, needsFor, tplById } from '../templateModal/templateData'

export const MISSING_MODELS_COPY = {
  title: 'This workflow is missing models',
  description: "This workflow requires models you haven't downloaded yet.",
  totalSize: 'Total download size:',
  downloadAll: 'Download all',
  gotIt: 'Ok, got it',
  footer:
    'Download and place these models in the correct folder. Nodes with missing models are highlighted red on the canvas.'
}

export interface MissingModels {
  template: Template
  models: ModelReq[]
}

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
  return { template, models: needsFor(template) }
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
  if (inst) startDownload(template, inst)
}

export function modelFolder(name: string): string {
  if (/vae/i.test(name)) return 'VAE'
  if (/clip|text_encoder|t5|qwen_2|umt5/i.test(name)) return 'TEXT ENCODER'
  if (/lora/i.test(name)) return 'LORA'
  return 'DIFFUSION'
}
