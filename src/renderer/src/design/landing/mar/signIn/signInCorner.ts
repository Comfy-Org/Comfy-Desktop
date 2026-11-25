import { computed, onBeforeUnmount, onMounted, reactive } from 'vue'
import { browserSignIn } from './browserSignIn'

const corners = reactive({ shown: 0 })

export const signInWaiting = computed(() => browserSignIn.pending && browserSignIn.banner)

export const signInCornerShown = computed(() => corners.shown > 0)

export function useSignInCorner(): void {
  onMounted(() => corners.shown++)
  onBeforeUnmount(() => corners.shown--)
}
