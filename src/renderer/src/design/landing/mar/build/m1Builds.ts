import { reactive } from 'vue'
import type { ProtoInstance } from '../../mock'

/**
 * The Builds milestone shows every state a build can be in today
 * (views/chooser/ChooserInstallTile.vue on bl/desktop-as-a-platform), so
 * the list has a few builds beyond the shared mock: one on a remote
 * server, a legacy install to migrate, and three a problem stopped
 * (a missing folder, a failed install, an uninstall that didn't finish).
 * Prototype data, kept while the prototype runs.
 */

/** What stops a build from starting, said in red where its specs go. */
export type BuildProblem = 'missing' | 'install-failed' | 'delete-interrupted'

export const PROBLEM_LABEL: Record<BuildProblem, string> = {
  missing: 'Folder Not Found',
  'install-failed': 'Install Failed',
  'delete-interrupted': 'Delete Interrupted'
}

/** The one way out of each problem, on the row's button. */
export const PROBLEM_ACTION: Record<BuildProblem, string> = {
  missing: 'Locate',
  'install-failed': 'Retry install',
  'delete-interrupted': 'Finish uninstall'
}

export interface BuildExtra {
  /** Runs on another machine, reached at this address. */
  remote?: string
  /** A legacy Desktop install that can move to Standalone. */
  migrate?: boolean
  problem?: BuildProblem
  /** Copied or migrated from another build. */
  from?: { how: 'Copied' | 'Migrated'; name: string }
}

const EXTRA: Record<string, BuildExtra> = {
  'local-video': { from: { how: 'Copied', name: 'My Local 1' } },
  'remote-studio': { remote: 'http://192.168.1.40:8188' },
  'local-legacy': { migrate: true },
  'local-sdxl': { problem: 'missing' },
  'local-wan': { problem: 'install-failed' },
  'local-old': { problem: 'delete-interrupted' }
}

export const extraOf = (id: string): BuildExtra => EXTRA[id] ?? {}

const base = {
  workspace: 'personal' as const,
  channel: 'Stable',
  version: 'v0.37.4',
  gpu: 'Apple M3 Max'
}

/** The builds only the Builds milestone lists. */
export const M1_BUILDS: ProtoInstance[] = reactive([
  {
    ...base,
    id: 'remote-studio',
    name: 'Studio Server',
    kind: 'cloud',
    channel: 'Remote',
    gpu: 'RTX 4090 · 24 GB',
    state: 'stopped',
    lastUsed: 'Yesterday',
    lastUsedRank: 4,
    hue: 160
  },
  {
    ...base,
    id: 'local-legacy',
    name: 'ComfyUI Desktop',
    channel: 'Legacy Desktop',
    version: 'v0.3.62',
    state: 'stopped',
    lastUsed: '3 weeks ago',
    lastUsedRank: 5,
    diskSize: '21.4 GB',
    kind: 'local',
    hue: 30
  },
  {
    ...base,
    id: 'local-sdxl',
    name: 'SDXL Archive',
    state: 'stopped',
    lastUsed: '2 months ago',
    lastUsedRank: 6,
    kind: 'local',
    hue: 280
  },
  {
    ...base,
    id: 'local-wan',
    name: 'Wan 2.2',
    state: 'stopped',
    lastUsed: 'Today',
    lastUsedRank: 7,
    kind: 'local',
    hue: 330
  },
  {
    ...base,
    id: 'local-old',
    name: 'Old Tests',
    state: 'stopped',
    lastUsed: '4 months ago',
    lastUsedRank: 8,
    kind: 'local',
    hue: 90
  }
])

export const m1BuildById = (id: string): ProtoInstance | undefined =>
  M1_BUILDS.find((b) => b.id === id)

export const isRemote = (b: ProtoInstance): boolean => Boolean(extraOf(b.id).remote)

/** Where a build runs, in the list's words. */
export type BuildWhere = 'local' | 'cloud' | 'remote'
export const whereOf = (b: ProtoInstance): BuildWhere =>
  isRemote(b) ? 'remote' : b.kind === 'cloud' ? 'cloud' : 'local'
