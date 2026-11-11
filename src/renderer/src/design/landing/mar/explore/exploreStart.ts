import { ref } from 'vue'

/** The tab Explore opens on, once: set when an older address (Workflows,
 *  Apps) lands in Explore at Milestone 3, or Assets lands in Apps'
 *  Generated Files at Milestone 2; read and cleared by Explore. */
export const exploreStart = ref<'apps' | 'templates' | 'files' | null>(null)
