import { computed } from 'vue'
import { proto } from '../../useProto'

/** Builds keep Milestone 1's design through Milestone 2: the list, a
 *  build's page and its tabs only change from Explore & Learn on. */
export const buildsAsM1 = computed(() => proto.milestone < 5)
