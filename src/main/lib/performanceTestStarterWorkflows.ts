import benchmarkTemplates from '../../../assets/benchmark-templates.json'
import { fetchJSON } from './fetch'
import {
  RAW_TEMPLATES_BASE,
  type TemplateModality,
  type TemplateSnapshot
} from '../sources/standalone/curatedTemplates'
import { hydrateTemplates, type HydratedTemplate } from '../sources/standalone/templateCatalog'
import type { FieldOption } from '../types/sources'

/**
 * API-format prompts for performance tests, published beside `templates/` in
 * the workflow_templates repo. Each shares its id with a parent template whose
 * editor workflow supplies the cover image and the model download URLs.
 */
const BENCHMARKS_BASE = RAW_TEMPLATES_BASE.replace(/\/templates$/, '/benchmarks')

interface BenchmarkTemplate {
  id: string
  modality: TemplateModality
  recommended?: boolean
  snapshot: TemplateSnapshot
}

/** Bundled list of the workflows in `benchmarks/`, with offline display metadata. */
const BENCHMARK_TEMPLATES = benchmarkTemplates.templates as BenchmarkTemplate[]

function loadPerformanceTestStarterCatalog(): Promise<HydratedTemplate[]> {
  return hydrateTemplates(BENCHMARK_TEMPLATES)
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

/** The workflow_templates repo could not be reached, typically because the user is offline. */
export class ExampleWorkflowsUnreachableError extends Error {
  constructor() {
    super('Connect to the internet to download example workflows.')
    this.name = 'ExampleWorkflowsUnreachableError'
  }
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

  const fileName = `${encodeURIComponent(templateId)}.json`
  try {
    const [editorWorkflow, apiWorkflow] = await Promise.all([
      fetchJSON(`${RAW_TEMPLATES_BASE}/${fileName}`, { refresh: true }),
      fetchJSON(`${BENCHMARKS_BASE}/${fileName}`, { refresh: true })
    ])
    return { template, editorWorkflow, apiWorkflow }
  } catch (error) {
    // Chromium reports a failed connection as `net::ERR_*` (e.g. ERR_NAME_NOT_RESOLVED
    // when offline); a reachable server answering with an error is `HTTP <status>`.
    if (/\bnet::ERR_/.test((error as Error)?.message ?? '')) {
      throw new ExampleWorkflowsUnreachableError()
    }
    throw error
  }
}
