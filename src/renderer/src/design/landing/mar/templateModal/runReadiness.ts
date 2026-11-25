import type { ProtoInstance, Template } from '../../mock'
import { instances, proto } from '../../useProto'
import {
  CASE_STATE,
  caseBuild,
  fmtGb,
  newBuildTarget,
  rankTargets,
  targetFor,
  totalGb,
  tplById,
  type Target
} from './templateData'

export type Readiness = 'ready' | 'download' | 'cloud' | 'credits' | 'signIn' | 'blocked' | 'setup'

export interface RunReadiness {
  kind: Readiness
  label: string
  detail: string
}

export interface TargetsOptions {
  insts?: ProtoInstance[]
  signedIn?: boolean
  modelsGoneOn?: string
  prefer?: string | null
}

export function targetsFor(t: Template, opts: TargetsOptions = {}): Target[] {
  const insts = opts.insts ?? instances.value
  const signedIn = opts.signedIn ?? proto.signedIn
  const list = insts.map((i) => targetFor(t, i, signedIn, i.id === opts.modelsGoneOn))
  const fresh = !insts.some((i) => i.kind === 'local' && !i.deployment)
  const add = fresh ? newBuildTarget(t) : undefined
  const prefer = opts.prefer === null ? undefined : (opts.prefer ?? caseBuild(t))
  return rankTargets(add ? [...list, add] : list, prefer)
}

export const bestTarget = (targets: Target[]): Target | undefined =>
  targets.find((x) => !x.disabled && x.state !== 'login')

export const downloadMinutes = (gb: number): number => Math.max(1, Math.round(gb / 5))

export const needsDownload = (x: Target): boolean =>
  x.state === 'download' ||
  x.state === 'new' ||
  (x.state === 'memory' && x.cost !== 'May fail') ||
  ((x.state === 'update' || x.state === 'nodes') && Boolean(x.fetch))

function downloadLabel(t: Template, x: Target): RunReadiness {
  const gb = totalGb(t) + (x.state === 'new' ? 2.4 : 0)
  const mins = x.state === 'new' ? Math.max(4, downloadMinutes(gb) + 3) : downloadMinutes(gb)
  return { kind: 'download', label: `Needs ${fmtGb(gb)} · ~${mins} min`, detail: x.note }
}

const READY: RunReadiness = { kind: 'ready', label: 'Ready to run', detail: 'Installed' }

function fromLocal(t: Template, x: Target): RunReadiness | undefined {
  if (x.state === 'running' || x.state === 'ready') return { ...READY, detail: x.status }
  if (needsDownload(x)) return downloadLabel(t, x)
  if (x.state === 'update' || x.state === 'nodes')
    return { kind: 'setup', label: x.status.split(' · ')[0]!, detail: x.note }
  const kase = CASE_STATE[x.state]
  if (kase && !x.disabled) return { kind: 'setup', label: kase.label, detail: x.note || x.status }
  return undefined
}

const CLOUD_BLOCKERS: Partial<Record<Target['state'], Readiness>> = {
  credits: 'credits',
  plan: 'credits',
  login: 'signIn'
}

function fromCloud(x: Target): RunReadiness | undefined {
  if (x.state === 'cloud')
    return { kind: 'cloud', label: 'Runs on Cloud', detail: 'Ready on Cloud' }
  const kind = CLOUD_BLOCKERS[x.state]
  const label = CASE_STATE[x.state]?.label
  return kind && label ? { kind, label, detail: x.note || x.status } : undefined
}

export function readinessOf(t: Template, targets: Target[] = targetsFor(t)): RunReadiness {
  const pinned = targets.find((x) => x.inst.id === caseBuild(t))
  if (pinned?.inst.kind === 'cloud' && CLOUD_BLOCKERS[pinned.state]) return fromCloud(pinned)!
  const local = targets.filter((x) => x.inst.kind !== 'cloud')
  const cloud = targets.filter((x) => x.inst.kind === 'cloud')
  const firstLocal = (pick: (x: Target) => boolean): Target | undefined =>
    local.find((x) => !x.disabled && pick(x))
  const ready = firstLocal((x) => x.state === 'running' || x.state === 'ready')
  if (ready) return fromLocal(t, ready)!
  const setup = firstLocal((x) => x.state !== 'memory' || x.cost !== 'May fail')
  const onCloud = cloud.map(fromCloud).find((r) => r?.kind === 'cloud')
  if (setup && !(onCloud && setup.state === 'memory')) {
    const r = fromLocal(t, setup)
    if (r) return r
  }
  if (onCloud) return onCloud
  const why = cloud.map(fromCloud).find(Boolean)
  if (why) return why
  const blocked = targets.find((x) => x.disabled) ?? targets[0]
  const kase = blocked && CASE_STATE[blocked.state]
  return {
    kind: 'blocked',
    label: kase?.label ?? 'Can’t run here',
    detail: blocked?.status ?? ''
  }
}

export function readinessFor(id: string): RunReadiness | undefined {
  const t = tplById(id)
  return t ? readinessOf(t) : undefined
}
