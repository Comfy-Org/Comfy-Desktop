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
}

export type HasModel = (directory: string, filename: string) => Promise<boolean>

interface IndexedTemplate {
  name: string
  title: string
  mediaSubtype: string
  partner: boolean
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
        partner: template.openSource === false
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

async function hasEveryModel(json: unknown, hasModel: HasModel): Promise<boolean> {
  for (const model of resolveTemplateModelsFromJson(json)) {
    if (!(await hasModel(model.directory, model.filename))) return false
  }
  return true
}

export async function readBuildTemplates(
  sitePackages: string,
  hasModel: HasModel
): Promise<BuildTemplates> {
  const templateDirs = TEMPLATE_PACKAGE_DIRS.map((pkg) => path.join(sitePackages, pkg, 'templates'))
  const labels = new Map<string, TemplateLabel>()
  const installed: string[] = []
  for (const template of indexedTemplates(await firstIndex(templateDirs))) {
    labels.set(template.name, {
      title: template.title,
      thumbnailUrl: thumbnailUrlFor(template.name, template.mediaSubtype),
      partner: template.partner
    })
    const json = await templateJson(templateDirs, template.name)
    if (json && (await hasEveryModel(json, hasModel))) installed.push(template.name)
  }
  return { installed, labels }
}
