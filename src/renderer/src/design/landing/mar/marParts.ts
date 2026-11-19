import { computed } from 'vue'

/**
 * What Home shows, decided per part: a large greeting, the Create menu, a
 * compact prompt, recent work as photo cards, What's new as a wide banner
 * (example workflows live in Agent). The parts stay named so a part can
 * change in one line.
 * Shell: the sidebar variants (marShell.ts), or Mar's earlier floating one.
 */

export interface Parts {
  shell: 'mar' | 'dock'
  top: 'roomy' | 'tight'
  builds: 'mar' | 'off'
  examples: 'mar' | 'off' | 'rows'
  news: 'mar' | 'banner'
}

const MAR: Parts = {
  shell: 'dock',
  top: 'roomy',
  builds: 'off',
  examples: 'off',
  news: 'banner'
}

/** The parts on screen. */
export const active = computed<Parts>(() => MAR)
