import { computed, reactive, ref, watch } from 'vue'
import { proto, toast } from './useProto'
import { realWorkspace } from './account'

/**
 * The user's real workflows per environment ("Data: Mine" inside the app):
 * Comfy Cloud's from the active workspace, each local install's from its
 * workflows folder (main: comfy-design:list-workflows). Refetched when the
 * environments, the sign-in or the workspace change.
 */
export interface RealWorkflow {
  envId: string
  /** Path inside the workflows folder. */
  path: string
  modified: number
}

export type EnvLoad = 'loading' | 'ready' | 'signed-out' | 'error'

const available = typeof window.api?.designListWorkflows === 'function'

/** Real data is on: inside the app, "Data: Mine". */
export const realDataOn = computed(() => available && proto.live)

export const realWorkflows = ref<RealWorkflow[]>([])
/** Load state per environment id. */
export const envLoad = reactive<Record<string, EnvLoad>>({})

let generation = 0
async function load(): Promise<void> {
  if (!realDataOn.value) return
  const seen = ++generation
  const envs = proto.liveInstances
  for (const e of envs) envLoad[e.id] = 'loading'
  const results = await Promise.all(
    envs.map(async (e) => ({ env: e, res: await window.api.designListWorkflows(e.id) }))
  )
  if (seen !== generation) return
  const next: RealWorkflow[] = []
  for (const { env, res } of results) {
    if (res.ok) {
      envLoad[env.id] = 'ready'
      for (const w of res.workflows)
        next.push({ envId: env.id, path: w.path, modified: w.modified })
    } else {
      envLoad[env.id] = res.reason === 'signed-out' ? 'signed-out' : 'error'
      if (res.reason === 'error') {
        console.warn(`[design] workflows for ${env.name}:`, res.message)
        toast(`Couldn't load ${env.name} workflows: ${res.message ?? 'unknown error'}`)
      }
    }
  }
  realWorkflows.value = next
}

watch(
  () => [
    realDataOn.value,
    proto.liveInstances.map((i) => i.id).join(),
    proto.signedIn,
    realWorkspace.value?.id
  ],
  () => void load(),
  { immediate: true }
)

/** "5 min ago", "3 hours ago", "Yesterday", "4 days ago", "2 weeks ago". */
export function relativeTime(ms: number): string {
  const mins = Math.max(1, Math.round((Date.now() - ms) / 60000))
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 14) return `${days} days ago`
  const weeks = Math.round(days / 7)
  if (weeks < 9) return `${weeks} weeks ago`
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}
