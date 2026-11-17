import { list as listInstallations, type InstallationRecord } from '../installations'
import {
  buildExistenceCandidates,
  getModelsBaseDir,
  regularFileExists,
  resolveDownloadContext
} from '../lib/modelDownloadPaths'
import type { TerminalEnv } from '../types/sources'
import type { TemplateSearchResponse } from '../../types/ipc'
import { readBuildTemplates, type BuildTemplates } from './buildTemplates'
import { buildRuntime } from './buildRuntime'
import { decideRequest, parseDecision } from './decisionApi'
import type { SearchProcess } from './searchProcess'

const TEMPLATES_TTL_MS = 60_000

export interface DesktopSearchOptions {
  process: Pick<SearchProcess, 'decide'>
  isLocalInstallation: (installation: InstallationRecord) => boolean
  terminalEnvOf: (installation: InstallationRecord) => TerminalEnv | null
  readTemplates?: typeof readBuildTemplates
  now?: () => number
}

function modelLookup(installation: InstallationRecord) {
  const context = resolveDownloadContext(installation)
  const baseDir = getModelsBaseDir()
  return async (directory: string, filename: string): Promise<boolean> => {
    for (const candidate of buildExistenceCandidates(context, baseDir, directory, filename)) {
      if (await regularFileExists(candidate)) return true
    }
    return false
  }
}

export function createDesktopSearch({
  process,
  isLocalInstallation,
  terminalEnvOf,
  readTemplates = readBuildTemplates,
  now = Date.now
}: DesktopSearchOptions) {
  const templates = new Map<string, { at: number; value: Promise<BuildTemplates | null> }>()

  function templatesFor(installation: InstallationRecord): Promise<BuildTemplates | null> {
    const cached = templates.get(installation.id)
    if (cached && now() - cached.at < TEMPLATES_TTL_MS) return cached.value
    const sitePackages = buildRuntime(installation, terminalEnvOf(installation))?.sitePackages
    const value = sitePackages
      ? readTemplates(sitePackages, modelLookup(installation)).catch(() => null)
      : Promise.resolve(null)
    templates.set(installation.id, { at: now(), value })
    return value
  }

  async function search(
    query: string,
    installationId: string | null
  ): Promise<TemplateSearchResponse> {
    const build = installationId
      ? (await listInstallations()).find((b) => b.id === installationId && isLocalInstallation(b))
      : undefined
    const known = build ? await templatesFor(build) : null
    const decision = await process.decide(decideRequest(query, known?.installed ?? null))
    if (decision.kind === 'unavailable') {
      return { kind: 'unavailable', availability: decision.availability }
    }
    const result = parseDecision(decision.body, (id) => known?.labels.get(id) ?? null)
    return result ? { kind: 'result', result } : { kind: 'failed' }
  }

  return {
    search,
    forget: (installationId: string): void => void templates.delete(installationId)
  }
}

export type DesktopSearch = ReturnType<typeof createDesktopSearch>
