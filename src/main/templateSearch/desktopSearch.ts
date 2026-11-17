import { list as listInstallations, type InstallationRecord } from '../installations'
import { modelOnDisk, resolveDownloadContext } from '../lib/modelDownloadPaths'
import type { TerminalEnv } from '../types/sources'
import type { TemplateSearchResponse } from '../../types/ipc'
import { readBuildTemplates, type BuildTemplates } from './buildTemplates'
import { buildRuntime } from './buildRuntime'
import { decideRequest, decisionMetrics, parseDecision } from './decisionApi'
import type { SearchProcess } from './searchProcess'

const TEMPLATES_TTL_MS = 60_000
const NOTHING_KNOWN: BuildTemplates = { installed: [], labels: new Map() }

export interface DesktopSearchOptions {
  process: Pick<SearchProcess, 'decide'>
  isLocalInstallation: (installation: InstallationRecord) => boolean
  terminalEnvOf: (installation: InstallationRecord) => TerminalEnv | null
  searchOn: () => boolean
  readTemplates?: typeof readBuildTemplates
  now?: () => number
}

function modelLookup(installation: InstallationRecord) {
  const context = resolveDownloadContext(installation)
  return (directory: string, filename: string): Promise<boolean> =>
    modelOnDisk(context, context.downloadBaseDir, directory, filename)
}

export function createDesktopSearch({
  process,
  isLocalInstallation,
  terminalEnvOf,
  searchOn,
  readTemplates = readBuildTemplates,
  now = Date.now
}: DesktopSearchOptions) {
  const templates = new Map<string, { at: number; value: Promise<BuildTemplates> }>()

  function templatesFor(installation: InstallationRecord): Promise<BuildTemplates> {
    const cached = templates.get(installation.id)
    if (cached && now() - cached.at < TEMPLATES_TTL_MS) return cached.value
    const sitePackages = buildRuntime(installation, terminalEnvOf(installation))?.sitePackages
    const value = sitePackages
      ? readTemplates(sitePackages, modelLookup(installation)).catch(() => NOTHING_KNOWN)
      : Promise.resolve(NOTHING_KNOWN)
    templates.set(installation.id, { at: now(), value })
    return value
  }

  async function search(
    query: string,
    installationId: string | null
  ): Promise<TemplateSearchResponse> {
    const build =
      installationId && searchOn()
        ? (await listInstallations()).find((b) => b.id === installationId && isLocalInstallation(b))
        : undefined
    const known = build ? await templatesFor(build) : null
    const decision = await process.decide(decideRequest(query, known?.installed ?? null))
    if (decision.kind === 'unavailable') {
      return { kind: 'unavailable', availability: decision.availability }
    }
    const result = parseDecision(decision.body, (id) => known?.labels.get(id) ?? null)
    if (!result) return { kind: 'failed' }
    return {
      kind: 'result',
      result,
      metrics: { ...decisionMetrics(decision.body), coldStart: decision.coldStart }
    }
  }

  return {
    search,
    forget: (installationId: string): void => void templates.delete(installationId)
  }
}

export type DesktopSearch = ReturnType<typeof createDesktopSearch>
