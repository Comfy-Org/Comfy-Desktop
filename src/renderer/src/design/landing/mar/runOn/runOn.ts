import { reactive } from 'vue'
import type { ProtoInstance } from '../../mock'
import { proto } from '../../useProto'
import { shownCredits } from '../../account'

/**
 * Data for the prompt's Run on picker (Mar's proposal): what each build
 * says when you pick where to run, in the order that matters for the
 * choice (state · GPU · VRAM), and when a build can't take the job.
 */

/** What the current job needs. Set by whatever fills the prompt (a starter
 *  card, a workflow); null when nothing is known. */
export const runOnNeed = reactive<{ vramGb: number | null }>({ vramGb: null })

/** Memory a build's GPU has (Apple silicon: the unified memory). */
const SHARED: Record<string, number> = { 'Apple M3 Max': 36 }

export function vramGb(i: ProtoInstance): number | null {
  const gb = i.gpu?.match(/(\d+)\s*GB/)
  if (gb) return Number(gb[1])
  return i.gpu ? (SHARED[i.gpu] ?? null) : null
}

function gpuText(i: ProtoInstance): string {
  if (!i.gpu) return ''
  const name = i.gpu.split(' · ')[0]!
  const gb = vramGb(i)
  if (gb === null) return name
  return `${name} · ${gb} GB`
}

const isComfyCloud = (i: ProtoInstance): boolean => i.kind === 'cloud' && !i.deployment

function state(i: ProtoInstance): string {
  if (i.state === 'running') return 'Running'
  if (i.state === 'launching') return 'Starting'
  if (i.state === 'error') return 'Failed to start'
  if (i.state === 'update') return 'Update ready'
  return i.deployment ? 'Asleep' : 'Stopped'
}

export function runOnMeta(i: ProtoInstance): string {
  if (isComfyCloud(i)) {
    if (!proto.signedIn) return 'Log in to start · free credits'
    return ['Ready', 'Cloud GPUs', shownCredits.value && `${shownCredits.value} credits`]
      .filter(Boolean)
      .join(' · ')
  }
  return [state(i), gpuText(i)].filter(Boolean).join(' · ')
}

/** The quiet hint on the right: what picking it costs you. */
export function runOnHint(i: ProtoInstance): string {
  if (isComfyCloud(i)) return proto.signedIn ? '~3 credits a run' : 'Log in'
  if (i.state === 'running' || i.state === 'launching') return ''
  return i.deployment ? '~20 s to start' : '~15 s to start'
}

/** Why a build can't take the job, or null when it can. */
export function runOnBlocked(i: ProtoInstance): string | null {
  const need = runOnNeed.vramGb
  const has = vramGb(i)
  if (need === null || has === null || has >= need) return null
  return `Needs ${need} GB, has ${has}`
}

/** Short name for the trigger. */
export const runOnShort = (i: ProtoInstance): string => (isComfyCloud(i) ? 'Cloud' : i.name)
