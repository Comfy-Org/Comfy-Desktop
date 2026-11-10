import { computed, reactive } from 'vue'
import { instances, proto } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import { assetsEverywhere } from './assetsEverywhere'

/**
 * The builds Assets can browse (Better Asset Management PRD, Phase 2):
 * one catalog at a time, read through that build's own ComfyUI, so only a
 * running build can be browsed. Comfy Cloud is one more catalog once
 * you're logged in. Starting a build here is the user's click, never
 * automatic; the proto fakes the start.
 */
export type AssetBuild = ProtoInstance

const started = reactive<Record<string, 'launching' | 'running'>>({})

export const assetBuilds = computed<AssetBuild[]>(() =>
  [...instances.value]
    .filter((i) => !i.deployment && (i.kind === 'local' || proto.signedIn))
    .sort((a, b) => a.lastUsedRank - b.lastUsedRank)
)

export function buildStatus(b: AssetBuild): 'running' | 'launching' | 'stopped' {
  return started[b.id] ?? (b.kind === 'cloud' || b.state === 'running' ? 'running' : 'stopped')
}

/** Where Assets opens: the build you last picked while it runs, else the
 *  most recent running build, a local one first. With none ('' here) it
 *  asks; nothing starts on its own. The picker always shows which build
 *  is in view, so the context stays explicit, as the PRD asks. */
const KEY = 'comfy.design.mar.assetBuild'
export function defaultBuild(): string {
  try {
    const v = localStorage.getItem(KEY) ?? ''
    if (v === 'all' && assetsEverywhere.id === 'on') return v
    const last = assetBuilds.value.find((b) => b.id === v)
    if (last && buildStatus(last) === 'running') return last.id
  } catch {
    // Storage blocked: fall through to the most recent running build.
  }
  const running = assetBuilds.value.filter((b) => buildStatus(b) === 'running')
  return (running.find((b) => b.kind === 'local') ?? running[0])?.id ?? ''
}
export function rememberBuild(id: string): void {
  try {
    if (id) localStorage.setItem(KEY, id)
  } catch {
    // Storage blocked: the pick lasts for this visit.
  }
}
/** The one a click on "Pick a build" suggests: the most recent running. */
export function suggestedBuild(): AssetBuild | undefined {
  const list = assetBuilds.value
  return list.find((b) => buildStatus(b) === 'running') ?? list[0]
}

export function startBuild(id: string): void {
  started[id] = 'launching'
  setTimeout(() => (started[id] = 'running'), 1400)
}
