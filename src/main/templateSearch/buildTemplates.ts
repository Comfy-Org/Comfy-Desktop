import path from 'path'
import { thumbnailUrlFor } from '../sources/standalone/curatedTemplates'
import {
  resolveTemplateModelsFromJson,
  TEMPLATE_PACKAGE_DIRS
} from '../sources/standalone/templateModels'
import type { TemplateLabel } from './decisionApi'
import { asRecord, readJson } from './json'

export interface BuildTemplates {
  installed: string[]
  labels: ReadonlyMap<string, TemplateLabel>
  downloadBytes: (templateId: string) => Promise<number | null>
}

export type ModelBytes = (directory: string, filename: string) => Promise<number | null>

const SMALLEST_BYTE_SIZE = 1_000_000

interface IndexedTemplate {
  name: string
  title: string
  mediaSubtype: string
  partner: boolean
  size: number | null
}

function sizeInBytes(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= SMALLEST_BYTE_SIZE
    ? value
    : null
}

export function indexedTemplates(index: unknown): IndexedTemplate[] {
  const found: IndexedTemplate[] = []
  for (const category of Array.isArray(index) ? index : []) {
    const templates = asRecord(category)?.templates
    for (const item of Array.isArray(templates) ? templates : []) {
      const template = asRecord(item)
      if (typeof template?.name !== 'string' || !template.name) continue
      found.push({
        name: template.name,
        title:
          typeof template.title === 'string' && template.title ? template.title : template.name,
        mediaSubtype: typeof template.mediaSubtype === 'string' ? template.mediaSubtype : 'webp',
        partner: template.openSource === false,
        size: sizeInBytes(template.size)
      })
    }
  }
  return found
}

async function firstIndex(templateDirs: string[]): Promise<unknown> {
  for (const dir of templateDirs) {
    const index = await readJson(path.join(dir, 'index.json'))
    if (Array.isArray(index)) return index
  }
  return null
}

async function templateJson(templateDirs: string[], name: string): Promise<unknown> {
  for (const dir of templateDirs) {
    const json = await readJson(path.join(dir, `${name}.json`))
    if (json) return json
  }
  return null
}

async function hasEveryModel(json: unknown, modelBytes: ModelBytes): Promise<boolean> {
  for (const model of resolveTemplateModelsFromJson(json)) {
    if ((await modelBytes(model.directory, model.filename)) === null) return false
  }
  return true
}

async function bytesOnDisk(json: unknown, modelBytes: ModelBytes): Promise<number> {
  let total = 0
  for (const model of resolveTemplateModelsFromJson(json)) {
    total += (await modelBytes(model.directory, model.filename)) ?? 0
  }
  return total
}

export async function readBuildTemplates(
  sitePackages: string,
  modelBytes: ModelBytes
): Promise<BuildTemplates> {
  const templateDirs = TEMPLATE_PACKAGE_DIRS.map((pkg) => path.join(sitePackages, pkg, 'templates'))
  const labels = new Map<string, TemplateLabel>()
  const sizes = new Map<string, number>()
  const installed: string[] = []
  for (const template of indexedTemplates(await firstIndex(templateDirs))) {
    labels.set(template.name, {
      title: template.title,
      thumbnailUrl: thumbnailUrlFor(template.name, template.mediaSubtype),
      partner: template.partner
    })
    if (template.size !== null) sizes.set(template.name, template.size)
    const json = await templateJson(templateDirs, template.name)
    if (json && (await hasEveryModel(json, modelBytes))) installed.push(template.name)
  }
  async function downloadBytes(templateId: string): Promise<number | null> {
    const size = sizes.get(templateId) ?? null
    const json = size === null ? null : await templateJson(templateDirs, templateId)
    if (size === null || !json) return null
    return Math.max(0, size - (await bytesOnDisk(json, modelBytes)))
  }

  return { installed, labels, downloadBytes }
}
