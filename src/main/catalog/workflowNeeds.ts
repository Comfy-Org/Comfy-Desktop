import { net } from 'electron'
import type { CatalogWorkflowModel, CatalogWorkflowNeeds } from '../../types/ipc'
import { usableLocalBuilds } from '../apps/localBuild'
import { missingModelFiles } from '../lib/modelDownloadPaths'
import {
  resolveTemplateModelsFromJson,
  type TemplateModelDownload
} from '../sources/standalone/templateModels'
import { fetchEditorGraph } from './editorGraph'
import { listedWorkflow } from './workflows'

const SIZE_TIMEOUT_MS = 5000
const MAX_SIZE_LOOKUPS = 24

const sizes = new Map<string, Promise<number | null>>()

function byteCount(value: string | null): number | null {
  if (value === null || !/^\d{1,15}$/.test(value)) return null
  const count = Number(value)
  return count > 0 ? count : null
}

async function lookUpSize(url: string): Promise<number | null> {
  try {
    const response = await net.fetch(url, {
      method: 'HEAD',
      credentials: 'omit',
      redirect: 'manual',
      signal: AbortSignal.timeout(SIZE_TIMEOUT_MS)
    })
    return (
      byteCount(response.headers.get('x-linked-size')) ??
      (response.ok ? byteCount(response.headers.get('content-length')) : null)
    )
  } catch {
    return null
  }
}

function sizeOf(url: string): Promise<number | null> {
  const known = sizes.get(url)
  if (known) return known
  const size = lookUpSize(url)
  sizes.set(url, size)
  void size.then((bytes) => {
    if (bytes === null) sizes.delete(url)
  })
  return size
}

export async function catalogWorkflowModels(
  graph: Record<string, unknown>
): Promise<TemplateModelDownload[]> {
  return resolveTemplateModelsFromJson(graph)
}

async function describeModels(models: TemplateModelDownload[]): Promise<CatalogWorkflowModel[]> {
  return Promise.all(
    models.map(async ({ filename, directory, url }, index) => ({
      filename,
      directory,
      sizeBytes: index < MAX_SIZE_LOOKUPS ? await sizeOf(url) : null
    }))
  )
}

async function missingByBuild(models: TemplateModelDownload[]): Promise<Record<string, string[]>> {
  const builds = await usableLocalBuilds()
  const entries = await Promise.all(
    builds.map(
      async (build) =>
        [
          build.id,
          (await missingModelFiles(build.id, models)).map(({ filename }) => filename)
        ] as const
    )
  )
  return Object.fromEntries(entries)
}

export async function catalogWorkflowGraph(id: string): Promise<Record<string, unknown> | null> {
  const url = listedWorkflow(id)?.editorGraphUrl
  return url ? fetchEditorGraph(url).catch(() => null) : null
}

export async function catalogWorkflowNeeds(id: unknown): Promise<CatalogWorkflowNeeds | null> {
  if (typeof id !== 'string' || !listedWorkflow(id)) return null
  const graph = await catalogWorkflowGraph(id)
  if (!graph) return { graph: null, models: [], missingByBuild: {} }
  const models = await catalogWorkflowModels(graph)
  const [described, missing] = await Promise.all([describeModels(models), missingByBuild(models)])
  return { graph, models: described, missingByBuild: missing }
}

export function _forgetModelSizesForTest(): void {
  sizes.clear()
}
