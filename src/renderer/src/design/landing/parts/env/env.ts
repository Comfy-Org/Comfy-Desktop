import { computed } from 'vue'
import { instances, isNewUser, proto } from '../../useProto'
import { SPACES } from '../../spaces'
import {
  DEPLOYMENTS,
  ENV_STATS,
  ENV_VERSIONS,
  PUBLISHED_LOCAL,
  type Deployment,
  type EnvStats,
  type EnvVersion,
  type ProtoInstance
} from '../../mock'

/**
 * The unified model.
 *   Environment  what: ComfyUI version + nodes + models (editable)
 *    ├ Versions  frozen snapshots (Manager snapshots locally, releases in the cloud)
 *    └ Runs on   This computer · Comfy Cloud · Deployments (pinned version + GPUs + endpoint)
 * Kinds are about where the definition lives, not different objects.
 */
export type EnvKind = 'local' | 'managed' | 'cloud'

export const envKind = (e: ProtoInstance): EnvKind =>
  e.kind === 'local' ? 'local' : e.deployment ? 'cloud' : 'managed'

export const envKindLabel = (e: ProtoInstance): string =>
  ({ local: 'On this computer', managed: 'Managed by Comfy', cloud: 'In the cloud' })[envKind(e)]

/** Deployments visible in the current workspace. */
// A tool's pinned version tells which environment its endpoint runs.
const ENV_OF_VERSION: Record<string, string> = {
  'Product Shots': 'dep-product',
  'My Local 1': 'local-1',
  'Flux Sandbox': 'local-flux',
  'Video Lab': 'local-video'
}
/** Every tool published into a space runs on its own endpoint - a
 *  deployment, tagged with its space. Same list as Build -> Deployments. */
const spaceDeployments = computed<Deployment[]>(() =>
  !proto.spaces
    ? []
    : SPACES.flatMap((sp) =>
        sp.catalog
          .filter((c) => c.endpoint)
          .map((c, i) => {
            const base = c.version?.replace(/ v\d+$/, '') ?? ''
            return {
              id: `sp-${sp.id}-${c.id}`,
              name: c.endpoint!.name,
              envId: ENV_OF_VERSION[base] ?? 'cloud',
              version: c.version?.match(/v\d+$/)?.[0] ?? 'latest',
              stage: 'production' as const,
              status: c.endpoint!.warm ? ('running' as const) : ('scaled-to-zero' as const),
              gpu: c.endpoint!.gpu,
              workers: c.endpoint!.warm ? '1–4' : '0–2',
              endpoint: `https://${sp.domain}/api/${c.endpoint!.name}`,
              requests7d: c.runs * 3,
              errorRate: [0.2, 0.6, 1.4, 0.3][i % 4]!,
              p95: ['8.1 s', '11.4 s', '6.9 s', '14.0 s'][i % 4]!,
              spend7d: Math.round(c.runs * c.cost * 0.4),
              trend: sp.trend.slice(-7),
              workspace: 'personal' as const,
              spaceId: sp.id,
              tool: c.name
            }
          })
      )
)
export const deployments = computed<Deployment[]>(() =>
  // New users haven't deployed anything yet.
  proto.signedIn && !isNewUser.value
    ? [
        ...DEPLOYMENTS.filter((d) => d.workspace === proto.workspaceId),
        ...(proto.workspaceId === 'personal' ? spaceDeployments.value : [])
      ]
    : []
)
export const deploymentsOf = (envId: string): Deployment[] =>
  deployments.value.filter((d) => d.envId === envId)
export const deploymentById = (id: string): Deployment | undefined =>
  deployments.value.find((d) => d.id === id)
export const envById = (id: string): ProtoInstance | undefined =>
  instances.value.find((i) => i.id === id)

export const versionsOf = (e: ProtoInstance): EnvVersion[] => ENV_VERSIONS[e.id] ?? []
export const isPublished = (e: ProtoInstance): boolean =>
  envKind(e) !== 'local' || PUBLISHED_LOCAL.has(e.id)

export interface RunsOn {
  where: 'computer' | 'cloud' | 'deployments'
  label: string
  live: boolean
}

/** Where an environment runs, as separate lines (local is 1:1, cloud is 1:N). */
export function runsOn(e: ProtoInstance): RunsOn[] {
  const out: RunsOn[] = []
  if (envKind(e) === 'local')
    out.push({ where: 'computer', label: 'This computer', live: e.state === 'running' })
  if (isPublished(e))
    out.push({
      where: 'cloud',
      label: 'Comfy Cloud',
      live: envKind(e) === 'managed' && proto.signedIn
    })
  const n = deploymentsOf(e.id).length
  if (n)
    out.push({
      where: 'deployments',
      label: `${n} deployment${n === 1 ? '' : 's'}`,
      live: deploymentsOf(e.id).some((d) => d.status === 'running')
    })
  return out
}

export interface EnvStatus {
  label: string
  live: boolean
  /** What it costs to start working in it. */
  start: string
}

export function envStatus(e: ProtoInstance): EnvStatus {
  const k = envKind(e)
  if (k === 'managed')
    return proto.signedIn
      ? { label: 'Always on', live: true, start: 'Opens instantly' }
      : { label: 'Log in to use', live: false, start: 'Needs an account' }
  if (k === 'cloud') return { label: 'Ready', live: false, start: 'Opens on Comfy Cloud in ~40 s' }
  if (e.state === 'running') return { label: 'Running', live: true, start: 'Already running' }
  if (e.state === 'update')
    return { label: 'Update available', live: false, start: 'Starts in ~20 s' }
  return { label: 'Stopped', live: false, start: 'Starts in ~20 s' }
}

const EMPTY: EnvStats = {
  runs7d: 0,
  gpuMin7d: 0,
  spend7d: 0,
  storageGb: 0,
  trend: [0, 0, 0, 0, 0, 0, 0]
}
export const statsOf = (e: ProtoInstance): EnvStats => ENV_STATS[e.id] ?? EMPTY

export const fmt = (n: number): string => n.toLocaleString('en-US')
export const fmtGpu = (min: number): string =>
  min >= 60 ? `${(min / 60).toFixed(1)} h` : `${min} min`
export const fmtCompact = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`
