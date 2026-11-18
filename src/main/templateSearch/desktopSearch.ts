import { list as listInstallations, type InstallationRecord } from '../installations'
import { modelBytesOnDisk, resolveDownloadContext } from '../lib/modelDownloadPaths'
import type { TerminalEnv } from '../types/sources'
import type {
  TemplateSearchCandidate,
  TemplateSearchResponse,
  TemplateSearchResult
} from '../../types/ipc'
import { readBuildTemplates, type BuildTemplates } from './buildTemplates'
import { buildRuntime } from './buildRuntime'
import { decideRequest, parseDecision } from './decisionApi'
import type { SearchProcess } from './searchProcess'

const TEMPLATES_TTL_MS = 60_000
const NOTHING_KNOWN: BuildTemplates = {
  installed: [],
  labels: new Map(),
  downloadBytes: async () => null
}

export interface DesktopSearchOptions {
  process: Pick<SearchProcess, 'decide'>
  isLocalInstallation: (installation: InstallationRecord) => boolean
  terminalEnvOf: (installation: InstallationRecord) => TerminalEnv | null
  searchOn: () => boolean
  partnersOn: () => boolean
  readTemplates?: typeof readBuildTemplates
  now?: () => number
}

function modelLookup(installation: InstallationRecord) {
  const context = resolveDownloadContext(installation)
  return (directory: string, filename: string): Promise<number | null> =>
    modelBytesOnDisk(context, context.downloadBaseDir, directory, filename)
}

async function withDownloadSizes(
  result: TemplateSearchResult,
  known: BuildTemplates
): Promise<TemplateSearchResult> {
  const sized = (candidates: TemplateSearchCandidate[]) =>
    Promise.all(
      candidates.map(async (candidate) =>
        candidate.needsDownload
          ? { ...candidate, downloadBytes: await known.downloadBytes(candidate.templateId) }
          : candidate
      )
    )
  return {
    ...result,
    download: await sized(result.download),
    more: await sized(result.more),
    alsoTry: await sized(result.alsoTry)
  }
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
    const partnersOff = !partnersOn()
    const decision = await process.decide((ready) =>
      decideRequest(query, known?.installed ?? null, { partnersOff: partnersOff && ready.partner })
    )
    if (decision.kind === 'unavailable') {
      return { kind: 'unavailable', availability: decision.availability }
    }
    const result = parseDecision(decision.body, (id) => known?.labels.get(id) ?? null)
    if (!result) return { kind: 'failed' }
    const sized = await withDownloadSizes(result, known ?? NOTHING_KNOWN)
    return {
      kind: 'result',
      result: { ...sized, partnerSwitch: decision.partnerSwitch, partnersShown: !partnersOff }
    }
  }

  return {
    search,
    forget: (installationId: string): void => void templates.delete(installationId)
  }
}

export type DesktopSearch = ReturnType<typeof createDesktopSearch>
