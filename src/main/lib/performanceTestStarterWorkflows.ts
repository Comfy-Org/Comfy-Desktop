import fs from 'node:fs'
import path from 'node:path'
import { fetchJSON } from './fetch'
import { isPersistableTemplateId, RAW_TEMPLATES_BASE } from '../sources/standalone/curatedTemplates'
import { loadTemplateCatalog, type HydratedTemplate } from '../sources/standalone/templateCatalog'
import type { FieldOption } from '../types/sources'

const API_WORKFLOWS_BASE = RAW_TEMPLATES_BASE.replace(/\/templates$/, '/api_workflows')
const API_WORKFLOWS_INDEX_URL = `${API_WORKFLOWS_BASE}/index.json`
const LOCAL_API_WORKFLOWS_DIR = path.resolve('assets')
const SHA256_PATTERN = /^[a-f0-9]{64}$/

interface ApiWorkflowIndexEntry {
  sourceSha256: string
  apiSha256: string
}

interface ApiWorkflowIndex {
  schemaVersion: 1
  workflows: Record<string, ApiWorkflowIndexEntry>
}

function parseApiWorkflowIndex(value: unknown): ApiWorkflowIndex | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as { schemaVersion?: unknown; workflows?: unknown }
  if (
    candidate.schemaVersion !== 1 ||
    !candidate.workflows ||
    typeof candidate.workflows !== 'object' ||
    Array.isArray(candidate.workflows)
  ) {
    return null
  }

  const workflows: Record<string, ApiWorkflowIndexEntry> = {}
  for (const [id, rawEntry] of Object.entries(candidate.workflows)) {
    if (!isPersistableTemplateId(id) || !rawEntry || typeof rawEntry !== 'object') continue
    const entry = rawEntry as Partial<ApiWorkflowIndexEntry>
    if (
      typeof entry.sourceSha256 !== 'string' ||
      !SHA256_PATTERN.test(entry.sourceSha256) ||
      typeof entry.apiSha256 !== 'string' ||
      !SHA256_PATTERN.test(entry.apiSha256)
    ) {
      continue
    }
    workflows[id] = { sourceSha256: entry.sourceSha256, apiSha256: entry.apiSha256 }
  }
  return { schemaVersion: 1, workflows }
}

async function loadApiWorkflowIndex(): Promise<ApiWorkflowIndex | null> {
  try {
    return parseApiWorkflowIndex(await fetchJSON(API_WORKFLOWS_INDEX_URL, { refresh: true }))
  } catch {
    return null
  }
}

async function loadLocalApiWorkflowIds(): Promise<Set<string>> {
  if (process.env.NODE_ENV !== 'development') return new Set()
  try {
    const entries = await fs.promises.readdir(LOCAL_API_WORKFLOWS_DIR, { withFileTypes: true })
    return new Set(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name.slice(0, -'.json'.length))
        .filter(isPersistableTemplateId)
    )
  } catch {
    return new Set()
  }
}

async function loadLocalApiWorkflow(templateId: string): Promise<unknown | null> {
  if (process.env.NODE_ENV !== 'development' || !isPersistableTemplateId(templateId)) return null
  try {
    const contents = await fs.promises.readFile(
      path.join(LOCAL_API_WORKFLOWS_DIR, `${templateId}.json`),
      'utf8'
    )
    return JSON.parse(contents)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function loadPerformanceTestStarterCatalog(): Promise<HydratedTemplate[]> {
  const [catalog, apiIndex, localApiWorkflowIds] = await Promise.all([
    loadTemplateCatalog(),
    loadApiWorkflowIndex(),
    loadLocalApiWorkflowIds()
  ])
  return catalog.filter(
    (template) =>
      template.apiNode !== true &&
      (apiIndex?.workflows[template.id] !== undefined || localApiWorkflowIds.has(template.id))
  )
}

export async function getPerformanceTestStarterOptions(): Promise<FieldOption[]> {
  return (await loadPerformanceTestStarterCatalog()).map((template) => ({
    value: template.id,
    label: template.title,
    description: template.description,
    recommended: template.recommended,
    data: {
      modality: template.modality,
      category: template.category,
      name: template.name,
      task: template.task,
      thumbnailUrl: template.thumbnailUrl,
      sizeBytes: template.sizeBytes,
      apiNode: false
    }
  }))
}

export interface PerformanceTestStarterArtifacts {
  template: HydratedTemplate
  editorWorkflow: unknown
  apiWorkflow: unknown
}

export async function loadPerformanceTestStarterArtifacts(
  templateId: string
): Promise<PerformanceTestStarterArtifacts> {
  const template = (await loadPerformanceTestStarterCatalog()).find(({ id }) => id === templateId)
  if (!template) {
    throw new Error('This starter workflow is unavailable for performance testing.')
  }

  const [editorWorkflow, localApiWorkflow] = await Promise.all([
    fetchJSON(`${RAW_TEMPLATES_BASE}/${encodeURIComponent(templateId)}.json`, { refresh: true }),
    loadLocalApiWorkflow(templateId)
  ])
  const apiWorkflow =
    localApiWorkflow ??
    (await fetchJSON(`${API_WORKFLOWS_BASE}/${encodeURIComponent(templateId)}.json`, {
      refresh: true
    }))
  if (!editorWorkflow) throw new Error('Could not download the starter workflow.')
  return { template, editorWorkflow, apiWorkflow }
}

export const performanceTestStarterArtifactUrls = {
  base: API_WORKFLOWS_BASE,
  index: API_WORKFLOWS_INDEX_URL
}
