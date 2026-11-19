import { computed } from 'vue'
import { allWorkflows } from '../../gallery'
import { instanceById } from '../../useProto'
import portraitSeaside from '../assets/portrait-seaside.jpg'
import portraitGarden from '../assets/portrait-garden.jpg'
import lakeFog from '../assets/lake-fog.jpg'
import portraitSun from '../assets/portrait-sun.jpg'
import hillsSunset from '../assets/hills-sunset.jpg'
import portraitSmile from '../assets/portrait-smile.jpg'
import forestFog from '../assets/forest-fog.jpg'
import portraitGrass from '../assets/portrait-grass.jpg'
import hillsFog from '../assets/hills-fog.jpg'
import portraitWindow from '../assets/portrait-window.jpg'

/**
 * Recently used, shared by 04 Filmstrip and 13 Library table so both show
 * the same items as the Home's cards row (kept in step with RECENT_ART and
 * `recent` in MarHomeV10.vue).
 */
export const RECENT_ART = [
  portraitSeaside,
  forestFog,
  portraitGrass,
  hillsFog,
  portraitWindow,
  portraitGarden,
  lakeFog,
  portraitSun,
  hillsSunset,
  portraitSmile
]

export const recent = computed(() =>
  [...allWorkflows.value]
    .sort((a, b) => a.age - b.age)
    .slice(0, 8)
    .map((w, i) => {
      const env = w.envId ? instanceById(w.envId) : undefined
      return {
        w,
        env,
        src: RECENT_ART[i % RECENT_ART.length]!,
        title: w.name.replace(/\.json$/, '')
      }
    })
)

export type RecentItem = (typeof recent.value)[number]

/** A clip's length for the mock, steady per item (0:04 to 0:12). */
export const clipSeconds = (id: string): number =>
  4 + ([...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 997, 7) % 9)

export const clock = (s: number): string =>
  `0:${String(Math.max(0, Math.round(s))).padStart(2, '0')}`
