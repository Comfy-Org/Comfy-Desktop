import { ref } from 'vue'

/** The tab Explore opens on, once: set when an older address (Workflows,
 *  Apps) lands in Explore at Milestone 3, read and cleared by Explore. */
export const exploreStart = ref<'apps' | 'templates' | null>(null)
