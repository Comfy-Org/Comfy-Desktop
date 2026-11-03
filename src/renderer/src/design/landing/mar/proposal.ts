import { computed, reactive, watch } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import { AgentChat } from './icons/agentChat'
import { proto } from '../useProto'
import { MILESTONES } from '../milestones'

/**
 * Which proposal the prototype shows (Prototype menu › Proposal, first):
 * Pablo's, as it is on his branch, or Mar's, which lives in this folder
 * only. Pablo's files only gain the hooks that pick between them, so his
 * daily changes merge in cleanly.
 *
 * Mar's proposal is always on Pablo's latest milestone; switching back
 * restores the milestone Pablo's was on, and picking another milestone
 * switches to Pablo's.
 */

export const PROPOSALS = [
  { value: 'pablo', label: 'Pablo' },
  { value: 'mariana', label: 'New UI' }
] as const

export type Proposal = (typeof PROPOSALS)[number]['value']

const KEY = 'comfy.design.proposal'
const LATEST_MILESTONE = Number(MILESTONES.at(-1)!.value)

// Links and picks from before there was one Mar proposal.
function normalize(v: string | null): Proposal | undefined {
  if (v?.startsWith('mariana')) return 'mariana'
  if (v === 'pablo') return 'pablo'
  return undefined
}

/** URL overrides storage (`?proposal=mariana`), for screenshots and links. */
function load(): Proposal {
  const fromUrl = normalize(new URLSearchParams(location.search).get('proposal'))
  if (fromUrl) return fromUrl
  try {
    return normalize(localStorage.getItem(KEY)) ?? 'pablo'
  } catch {
    // Storage blocked: fall back to Pablo's.
    return 'pablo'
  }
}

export const proposal = reactive<{ id: Proposal }>({ id: load() })

export const isMariana = computed(() => proposal.id === 'mariana')

let pabloMilestone = proto.milestone
watch(
  () => proposal.id,
  (id, before) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
    if (id === 'mariana') {
      if (before === 'pablo') pabloMilestone = proto.milestone
      proto.milestone = LATEST_MILESTONE
    } else if (before === 'mariana') {
      proto.milestone = pabloMilestone
    }
  },
  { immediate: true }
)

// Picking a milestone while on Mar's means looking at Pablo's scope for it.
watch(
  () => proto.milestone,
  (m) => {
    if (isMariana.value && m !== LATEST_MILESTONE) {
      pabloMilestone = m
      proposal.id = 'pablo'
    }
  }
)

window.addEventListener('storage', (e) => {
  if (e.key === KEY) proposal.id = load()
})

/** The Agent lens icon: a chat bubble in Mar's proposal. */
export const agentIcon = computed(() => (isMariana.value ? AgentChat : Sparkles))
