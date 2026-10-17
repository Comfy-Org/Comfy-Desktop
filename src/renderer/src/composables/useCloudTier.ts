import { computed, onMounted, ref } from 'vue'
import type { CloudUserTier } from '../types/ipc'

/** Whether the dashboard advertises Comfy Cloud: the free-runs pill and the
 *  "Why try Cloud" entry show only to users who don't pay yet. */
export function useCloudTier() {
  const cloudFreeRunsEnabled = ref(false)
  const cloudUserTier = ref<CloudUserTier>('unknown')
  const cloudUserTierResolved = ref(false)

  const showCloudFreeRunsPill = computed(
    () => cloudFreeRunsEnabled.value && cloudUserTier.value !== 'paid'
  )
  const showWhyCloud = computed(() => cloudUserTierResolved.value && cloudUserTier.value !== 'paid')

  onMounted(async () => {
    const [freeRunsResult, userTierResult] = await Promise.allSettled([
      window.api.getCloudFreeRunsEnabled(),
      window.api.getCloudUserTier()
    ])
    if (freeRunsResult.status === 'fulfilled') {
      cloudFreeRunsEnabled.value = freeRunsResult.value
    }
    if (userTierResult.status === 'fulfilled') {
      cloudUserTier.value = userTierResult.value
      cloudUserTierResolved.value = true
    }
  })

  return { showCloudFreeRunsPill, showWhyCloud }
}
