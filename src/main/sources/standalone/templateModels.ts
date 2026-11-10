import fs from 'fs'
import path from 'path'
import { getActiveVenvDir } from '../../lib/pythonEnv'
import { findSitePackages } from './envPaths'
import { ALLOWED_EXTENSIONS, stripQueryParams } from '../../lib/downloadFilename'
import { fetchJSON } from '../../lib/fetch'
import { RAW_TEMPLATES_BASE } from './curatedTemplates'
import type { InstallationRecord } from '../../installations'

export interface TemplateModelDownload {
  filename: string
  url: string
  directory: string
}

const ALLOWED_HOSTS = ['huggingface.co', 'civitai.com', 'civitai.red']

interface RawModel {
  name?: unknown
  url?: unknown
  directory?: unknown
}

const RAW_TEMPLATES_REMOTE_BASE = RAW_TEMPLATES_BASE

const TEMPLATE_PACKAGE_DIRS = [
  'comfyui_workflow_templates',
  'comfyui_workflow_templates_media_image',
  'comfyui_workflow_templates_media_video',
  'comfyui_workflow_templates_media_audio',
  'comfyui_workflow_templates_media_other',
  'comfyui_workflow_templates_media_api'
]

export async function loadTemplateJson(
  installation: InstallationRecord | null,
  templateId: string
): Promise<unknown | null> {
  const sitePackages = installation ? findSitePackages(getActiveVenvDir(installation)) : null
  if (sitePackages) {
    for (const pkg of TEMPLATE_PACKAGE_DIRS) {
      const local = path.join(sitePackages, pkg, 'templates', `${templateId}.json`)
      try {
        const raw = await fs.promises.readFile(local, 'utf-8')
        return JSON.parse(raw)
      } catch {}
    }
  }
  // global fetch — which can hang in the Electron main process), so it shares
  try {
    return await fetchJSON(`${RAW_TEMPLATES_REMOTE_BASE}/${templateId}.json`, { refresh: true })
  } catch {
    return null
  }
}

function isAcceptableModelUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  if (!ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return false
  const lowerPath = parsed.pathname.toLowerCase()
  return ALLOWED_EXTENSIONS.some((ext) => lowerPath.endsWith(ext))
}

export function sanitizeModelPath(
  directory: string,
  name: string
): { directory: string; filename: string } | null {
  const normalizedDir = path.posix.normalize(directory.replace(/\\/g, '/'))
  const dirNoTrail = normalizedDir.replace(/\/+$/, '')
  if (
    dirNoTrail === '' ||
    dirNoTrail === '.' ||
    path.posix.isAbsolute(normalizedDir) ||
    normalizedDir === '..' ||
    normalizedDir.startsWith('../') ||
    normalizedDir.includes('/../')
  ) {
    return null
  }
  const filename = stripQueryParams(name)
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return null
  }
  return { directory: normalizedDir, filename }
}

function collectModels(arr: unknown, out: RawModel[]): void {
  if (Array.isArray(arr)) {
    for (const m of arr) {
      if (m && typeof m === 'object') out.push(m as RawModel)
    }
  }
}

function walkNodes(nodes: unknown, out: RawModel[]): void {
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const n = node as { properties?: { models?: unknown }; nodes?: unknown }
    collectModels(n.properties?.models, out)
    if (Array.isArray(n.nodes)) walkNodes(n.nodes, out)
  }
}

export async function resolveTemplateModels(
  installation: InstallationRecord | null,
  templateId: string
): Promise<TemplateModelDownload[]> {
  const json = await loadTemplateJson(installation, templateId)
  return resolveTemplateModelsFromJson(json)
}

export function resolveTemplateModelsFromJson(json: unknown): TemplateModelDownload[] {
  if (!json || typeof json !== 'object') return []

  const doc = json as {
    models?: unknown
    nodes?: unknown
    definitions?: { subgraphs?: unknown }
  }

  const raw: RawModel[] = []
  collectModels(doc.models, raw)
  walkNodes(doc.nodes, raw)
  const subgraphs = doc.definitions?.subgraphs
  if (Array.isArray(subgraphs)) {
    for (const sg of subgraphs) {
      if (sg && typeof sg === 'object') walkNodes((sg as { nodes?: unknown }).nodes, raw)
    }
  }

  const seen = new Set<string>()
  const result: TemplateModelDownload[] = []
  for (const m of raw) {
    if (
      typeof m.name !== 'string' ||
      typeof m.url !== 'string' ||
      typeof m.directory !== 'string'
    ) {
      continue
    }
    if (!isAcceptableModelUrl(m.url)) continue
    const safe = sanitizeModelPath(m.directory, m.name)
    if (!safe) continue
    const key = `${safe.directory}/${safe.filename}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ filename: safe.filename, url: m.url, directory: safe.directory })
  }
  return result
}
