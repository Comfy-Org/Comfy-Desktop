import { reactive } from 'vue'
import type { ProtoInstance, Template } from '../../mock'
import { hostActions, instances, proto, toast } from '../../useProto'
import { graphOpen } from '../graph/graphOpen'
import { startDownload } from '../downloads/templateDownloads'
import { openPrepTab } from '../autorun/prepTabs'
import { needsDownload } from '../templateModal/runReadiness'
import {
  addAppTemplate,
  fmtGb,
  targetFor,
  totalGb,
  type Target
} from '../templateModal/templateData'
import {
  errorText,
  holdForDownload,
  openAnswer,
  workflowName,
  type AppGraph,
  type OpenError
} from './appToComfy'

export type OpenWhere = 'local' | 'cloud'

export interface OpenAppRequest {
  where: OpenWhere
  build?: string
  graph: AppGraph
}

export const opening = reactive<{ key: string }>({ key: '' })

const START_MS = 1800
const SHOW_MS = 450

export const localBuilds = (): ProtoInstance[] =>
  instances.value.filter((i) => i.kind === 'local' && !i.deployment)

const cloudBuild = (): ProtoInstance | undefined =>
  instances.value.find((i) => i.kind === 'cloud' && !i.deployment)

const isRunning = (inst: ProtoInstance): boolean =>
  inst.state === 'running' || proto.tabs.some((t) => t.instanceId === inst.id)

export function chooseLocalBuild(builds: ProtoInstance[]): ProtoInstance | undefined {
  return [...builds].sort(
    (a, b) => Number(isRunning(b)) - Number(isRunning(a)) || a.lastUsedRank - b.lastUsedRank
  )[0]
}

type Resolved = { inst: ProtoInstance } | { error: OpenError; name?: string }

function resolve(req: OpenAppRequest): Resolved {
  if (req.where === 'cloud') {
    const cloud = cloudBuild()
    if (!cloud) return { error: 'openNoCloud' }
    if (!proto.signedIn) return { error: 'openCloudFailed' }
    return { inst: cloud }
  }
  const builds = localBuilds()
  if (req.build !== undefined && !builds.some((b) => b.id === req.build))
    return { error: 'openUnknownBuild' }
  const inst = builds.find((b) => b.id === req.build) ?? chooseLocalBuild(builds)
  return inst ? { inst } : { error: 'noBuilds' }
}

export function buildFor(req: Omit<OpenAppRequest, 'graph'>): ProtoInstance | undefined {
  const r = resolve({ ...req, graph: {} as AppGraph })
  return 'inst' in r ? r.inst : undefined
}

function land(inst: ProtoInstance, graph: AppGraph): void {
  graphOpen.app = graph
  hostActions.launch(inst, workflowName(graph.name))
}

export function openAppInComfy(req: OpenAppRequest, key: string): void {
  if (opening.key) return
  const r = resolve(req)
  const forced = openAnswer.id === 'auto' ? undefined : openAnswer.id
  if (forced || 'error' in r) {
    const name = 'inst' in r ? r.inst.name : undefined
    toast(errorText(forced ?? (r as { error: OpenError }).error, name))
    return
  }
  opening.key = key
  setTimeout(
    () => {
      opening.key = ''
      land(r.inst, req.graph)
    },
    isRunning(r.inst) ? SHOW_MS : START_MS
  )
}

const MODELS_LIKE = { image: 'image_qwen_image_edit_2511', video: 'video_wan2_2_14B_i2v' }

export function appTemplate(graph: AppGraph): Template {
  const t: Template = {
    id: `app~${graph.appId}`,
    title: workflowName(graph.name),
    kind: 'app',
    category: graph.video ? 'video' : 'image',
    runs: 'both'
  }
  addAppTemplate(
    t,
    graph.video ? MODELS_LIKE.video : MODELS_LIKE.image,
    graph.image ?? graph.output
  )
  return t
}

export function targetOf(graph: AppGraph, inst: ProtoInstance): Target {
  return targetFor(appTemplate(graph), inst, proto.signedIn)
}

export function buildLine(graph: AppGraph, inst: ProtoInstance): string {
  if (inst.kind === 'cloud') return 'Every model ready'
  const x = targetOf(graph, inst)
  if (needsDownload(x)) return `Downloads ${fmtGb(totalGb(appTemplate(graph)))} of models first`
  return x.status
}

export function openOnBuild(graph: AppGraph, inst: ProtoInstance, key: string): void {
  if (inst.kind === 'cloud') {
    openAppInComfy({ where: 'cloud', graph }, key)
    return
  }
  const x = targetOf(graph, inst)
  if (!needsDownload(x)) {
    openAppInComfy({ where: 'local', build: inst.id, graph }, key)
    return
  }
  const t = appTemplate(graph)
  holdForDownload(t.id, graph)
  startDownload(t, inst)
  openPrepTab(t, inst)
  const tab = proto.tabs.at(-1)
  if (tab) {
    proto.activeInstanceId = inst.id
    proto.activeTab = tab.id
  }
}
