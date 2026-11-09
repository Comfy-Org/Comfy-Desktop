import { computed, reactive, watch } from 'vue'
import { can } from '../../milestones'
import { proto } from '../../useProto'
import { PROJECTS } from '../../mock'
import { SPACES, type Space } from '../../spaces'
import { favorites } from '../favorites'
import { onCloud } from '../shell/surface'

/**
 * Who is looking at the prototype (UI Playground › User) and what is on
 * this computer (UI Playground › Local install). Two axes, not one:
 *
 *  - User: First-time has made, run, starred and shared nothing yet;
 *    Returning has today's mock data.
 *  - Local install: None, One (just set up) or Several (today's mock:
 *    one running, one stopped, one with an update). On Cloud (a
 *    browser) there is never one, whatever this says.
 *
 * A first-time user usually has no local install yet (that is the first
 * run, UI Playground › First run), but can have one right after setup. A
 * returning user may have none either: they work on Comfy Cloud.
 *
 * Both write to the shared data, never to single sections:
 * `proto.newUser` (instances, workflows, assets and deployments read it),
 * `proto.fresh` / `proto.oneLocal` (which local builds exist), and the
 * user's own spaces, projects and favourites, which a first-time user
 * does not have, so they are set aside and given back on Returning.
 *
 * First run lives on Home, so before Milestone 4 everyone is a returning
 * user with the usual builds.
 */
export type MarUser = 'first' | 'returning'
export type MarLocal = 'none' | 'one' | 'several'

export const MAR_USERS: { value: MarUser; label: string }[] = [
  { value: 'first', label: 'First-time' },
  { value: 'returning', label: 'Returning' }
]
export const MAR_LOCALS: { value: MarLocal; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'one', label: 'One' },
  { value: 'several', label: 'Several' }
]

const KEY = 'comfy.design.mar.user'
const STASH_KEY = 'comfy.design.mar.user.favorites'

function load(): { user: MarUser; local: MarLocal } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      user: v.user === 'first' ? 'first' : 'returning',
      local: ['none', 'one', 'several'].includes(v.local) ? v.local : 'several'
    }
  } catch {
    return { user: 'returning', local: 'several' }
  }
}

export const marUser = reactive(load())

/** Seen as a first-time user. */
export const firstTime = computed(() => can.value.home && marUser.user === 'first')

/** Pick a user; each comes with its usual install (first-time: none yet,
 *  returning: several), which Local install can then change. */
export function setUser(user: MarUser): void {
  marUser.user = user
  marUser.local = user === 'first' ? 'none' : 'several'
}

watch(
  () => ({ ...marUser }),
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

// Which local builds exist.
watch(
  [firstTime, () => marUser.local, onCloud, () => can.value.home, () => marUser.user],
  ([first, local, cloud, home, user]) => {
    proto.newUser = first
    // Before there is a Home, only the local setup's first launch starts
    // with nothing installed.
    proto.fresh = (home || user === 'first') && (cloud || local === 'none')
    // Before there is a Home, only someone who just ran the local setup
    // has a single build: Builds lists it alone.
    proto.oneLocal = local === 'one' && (home || user === 'first')
  },
  { immediate: true }
)

// A first-time user has no spaces, projects or favourites of their own.
// They are set aside (favourites in storage too, so a reload as
// first-time doesn't lose the returning user's stars) and come back on
// Returning, with anything made in between kept after them.
let spaces: Space[] | undefined
let projects: (typeof PROJECTS)[number][] | undefined
watch(
  firstTime,
  (first) => {
    if (first) {
      spaces ??= SPACES.splice(0)
      projects ??= PROJECTS.splice(0)
      if (!readStash()) writeStash(favorites.keys)
      favorites.keys = []
      // A client inside a space is someone else's journey.
      proto.viewAs = 'studio'
    } else {
      if (spaces) SPACES.unshift(...spaces)
      if (projects) PROJECTS.unshift(...projects)
      spaces = projects = undefined
      const stars = readStash()
      if (stars) favorites.keys = [...stars, ...favorites.keys.filter((k) => !stars.includes(k))]
      writeStash(null)
    }
  },
  { immediate: true }
)

function readStash(): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(STASH_KEY) ?? 'null')
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}
function writeStash(keys: string[] | null): void {
  try {
    if (keys) localStorage.setItem(STASH_KEY, JSON.stringify(keys))
    else localStorage.removeItem(STASH_KEY)
  } catch {
    // Storage blocked: the stars come back from memory only.
  }
}
