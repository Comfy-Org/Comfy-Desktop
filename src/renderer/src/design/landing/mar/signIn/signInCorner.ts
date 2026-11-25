import { computed, onBeforeUnmount, onMounted, reactive } from 'vue'
import { browserSignIn } from './browserSignIn'

export const WAITING_COPY = {
  title: 'Waiting for your browser…',
  body: 'Finish signing in there',
  cancel: 'Cancel',
  openAgain: 'Open browser again',
  runNote: 'Sign in to run this app',
  runBody: 'It runs as soon as you’re back'
} as const

const corners = reactive({ shown: 0 })

export const signInWaiting = computed(() => browserSignIn.pending && browserSignIn.banner)

export const signInCornerShown = computed(() => corners.shown > 0)

export function useSignInCorner(): void {
  onMounted(() => corners.shown++)
  onBeforeUnmount(() => corners.shown--)
}
