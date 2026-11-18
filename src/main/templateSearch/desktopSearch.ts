import { list as listInstallations, type InstallationRecord } from '../installations'
import { modelBytesOnDisk, modelOnDisk, resolveDownloadContext } from '../lib/modelDownloadPaths'
import type { TerminalEnv } from '../types/sources'
import type { TemplateSearchResponse, TemplateSearchResult } from '../../types/ipc'
import { readBuildTemplates, type BuildTemplates } from './buildTemplates'
import { buildRuntime } from './buildRuntime'
import { decideRequest, decisionMetrics, parseDecision } from './decisionApi'
import type { SearchProcess } from './searchProcess'

const TEMPLATES_TTL_MS = 60_000
const NOTHING_KNOWN: BuildTemplates = {
  installed: [],
  labels: new Map(),
  downloadBytes: async () => null
}

export interface DesktopSearchOptions {
  process: Pick<SearchProcess, 'decide' | 'prepare' | 'partnerSwitch'>
  isLocalInstallation: (installation: InstallationRecord) => boolean
  terminalEnvOf: (installation: InstallationRecord) => TerminalEnv | null
  searchOn: () => boolean
  partnersOn: () => boolean
  readTemplates?: typeof readBuildTemplates
  now?: () => number
}

function modelLookup(installation: InstallationRecord) {
  const context = resolveDownloadContext(installation)
  return {
    has: (directory: string, filename: string): Promise<boolean> =>
      modelOnDisk(context, context.downloadBaseDir, directory, filename),
    bytes: (directory: string, filename: string): Promise<number | null> =>
      modelBytesOnDisk(context, context.downloadBaseDir, directory, filename)
  }
}

async function withDownloadSizes(
  result: TemplateSearchResult,
  known: BuildTemplates
): Promise<TemplateSearchResult> {
  const download = await Promise.all(
    result.download.map(async (candidate) => ({
      ...candidate,
      downloadBytes: await known.downloadBytes(candidate.templateId)
    }))
  )
  return { ...result, download }
}

export function createDesktopSearch({
  process,
  isLocalInstallation,
  terminalEnvOf,
  searchOn,
  partnersOn,
  readTemplates = readBuildTemplates,
  now = Date.now
}: DesktopSearchOptions) {
  const templates = new Map<string, { at: number; value: Promise<BuildTemplates> }>()

  function templatesFor(installation: InstallationRecord): Promise<BuildTemplates> {
    const cached = templates.get(installation.id)
    if (cached && now() - cached.at < TEMPLATES_TTL_MS) return cached.value
    const sitePackages = buildRuntime(installation, terminalEnvOf(installation))?.sitePackages
    const lookup = modelLookup(installation)
    const value = sitePackages
      ? readTemplates(sitePackages, lookup.has, lookup.bytes).catch(() => NOTHING_KNOWN)
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
    const partnersOff = !partnersOn()
    if (partnersOff) await process.prepare()
    const decision = await process.decide(
      decideRequest(query, known?.installed ?? null, {
        partnersOff: partnersOff && process.partnerSwitch()
      })
    )
    if (decision.kind === 'unavailable') {
      return { kind: 'unavailable', availability: decision.availability }
    }
    const result = parseDecision(decision.body, (id) => known?.labels.get(id) ?? null)
    if (!result) return { kind: 'failed' }
    const sized = await withDownloadSizes(result, known ?? NOTHING_KNOWN)
    return {
      kind: 'result',
      result: { ...sized, partnerSwitch: process.partnerSwitch() },
      metrics: { ...decisionMetrics(decision.body), coldStart: decision.coldStart }
    }
  }

  return {
    search,
    forget: (installationId: string): void => void templates.delete(installationId)
  }
}

export type DesktopSearch = ReturnType<typeof createDesktopSearch>
