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
const MAX_SIZE_HOPS = 3
const LINKED_SIZE = 'x-linked-size'

const sizes = new Map<string, Promise<number | null>>()

function byteCount(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,15}$/.test(value)) return null
  const count = Number(value)
  return count > 0 ? count : null
}

function header(headers: Record<string, string | string[]>, wanted: string): string | undefined {
  const name = Object.keys(headers).find((key) => key.toLowerCase() === wanted)
  const value = name === undefined ? undefined : headers[name]
  return Array.isArray(value) ? value[0] : value
}

function staysOnHost(from: string, to: string): boolean {
  try {
    return new URL(to).origin === new URL(from).origin
  } catch {
    return false
  }
}

function lookUpSize(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    let request: Electron.ClientRequest | null = null
    let hopsLeft = MAX_SIZE_HOPS
    const answer = (bytes: number | null): void => {
      clearTimeout(timer)
      resolve(bytes)
      request?.abort()
    }
    const timer = setTimeout(() => answer(null), SIZE_TIMEOUT_MS)
    try {
      request = net.request({ url, method: 'HEAD', credentials: 'omit', redirect: 'manual' })
      const asked = request
      asked.on('redirect', (_status, _method, redirectUrl, headers) => {
        const linked = byteCount(header(headers, LINKED_SIZE))
        hopsLeft -= 1
        if (linked !== null || hopsLeft < 0 || !staysOnHost(url, redirectUrl)) answer(linked)
        else asked.followRedirect()
      })
      asked.on('response', (response) => {
        const ok = response.statusCode >= 200 && response.statusCode < 300
        answer(
          byteCount(header(response.headers, LINKED_SIZE)) ??
            (ok ? byteCount(header(response.headers, 'content-length')) : null)
        )
      })
      asked.on('error', () => answer(null))
      asked.end()
    } catch {
      answer(null)
    }
  })
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

export async function knownDownloadBytes(models: TemplateModelDownload[]): Promise<number> {
  const known = await Promise.all(models.slice(0, MAX_SIZE_LOOKUPS).map(({ url }) => sizeOf(url)))
  return known.reduce<number>((total, bytes) => total + (bytes ?? 0), 0)
}

export function modelKey({ directory, filename }: { directory: string; filename: string }): string {
  return `${directory}/${filename}`
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
        [build.id, (await missingModelFiles(build.id, models)).map(modelKey)] as const
    )
  )
  return Object.fromEntries(entries)
}

export async function catalogWorkflowNeeds(id: unknown): Promise<CatalogWorkflowNeeds | null> {
  const workflow = typeof id === 'string' ? listedWorkflow(id) : undefined
  if (!workflow) return null
  if (!workflow.editorGraphUrl) return { graph: null, models: [], missingByBuild: {} }
  const graph = await fetchEditorGraph(workflow.editorGraphUrl)
  const models = await catalogWorkflowModels(graph)
  const [described, missing] = await Promise.all([describeModels(models), missingByBuild(models)])
  return { graph, models: described, missingByBuild: missing }
}

export function _forgetModelSizesForTest(): void {
  sizes.clear()
}
