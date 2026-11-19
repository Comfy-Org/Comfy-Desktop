import { ref, watch } from 'vue'
import { goIn, proto } from '../../useProto'
import { landingPage } from '../../milestones'

/** The last mode with a Home of its own (Create or Build), so Agent's way
 *  back (the sidebar's Home, the Comfy logo) lands where you came from. */
const lastMode = ref<'create' | 'build'>(proto.mode === 'build' ? 'build' : 'create')
watch(
  () => proto.mode,
  (m) => {
    if (m === 'create' || m === 'build') lastMode.value = m
  }
)

/** Home in a given mode: Create's landing or Build's overview. */
export function goModeHome(m: 'create' | 'build' = lastMode.value): void {
  goIn(m, m === 'build' ? 'build-overview' : landingPage())
  proto.activeTab = 'home'
}
