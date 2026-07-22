<script setup lang="ts">
/**
 * The Comfy Builder sign-in gate. One screen: sign in, and first-use is over.
 *
 * There is deliberately no workspace-selection step — the user picks their
 * workspace on the web login page before the token is ever minted, so asking
 * again here would be a second answer to a settled question. Switching
 * workspace afterwards lives in the account chip's dropdown instead.
 *
 * Renders layout-less: FirstUseTakeover already owns a `BrandTakeoverLayout`,
 * and a second one would replay the entrance animation on every start ⇄ chain
 * crossing. The footer Skip teleports into an anchor the parent exposes inside
 * its layout's `footer-left` slot (`defer` because that slot is patched after
 * this subtree on first render).
 */
import { ChevronLeft } from 'lucide-vue-next'
import DevPlatformSignInStep from './DevPlatformSignInStep.vue'
import { useAuthStore } from '../../stores/authStore'

const emit = defineEmits<{
  /** Signed in — the host ends first-use and drops the user on the chooser. */
  complete: []
  /** The user opted out of signing in; the host returns to the start screen. */
  skip: []
}>()

const store = useAuthStore()

/** Host-callable reset. Constructor state is never trusted for takeover
 *  content, same rule the host applies to FirstUseTakeover itself; this also
 *  invalidates a sign-in abandoned mid-wait on a previous entry. */
function open(): void {
  if (!store.isSignedIn) store.cancelSignIn()
}

defineExpose({ open })
</script>

<template>
  <div class="dp-chain">
    <DevPlatformSignInStep
      class="dp-chain__step"
      @signed-in="emit('complete')"
      @skip="emit('skip')"
    />
  </div>

  <!-- ONE home for backward navigation, in the parent's footer-left slot. -->
  <Teleport defer to="#dp-chain-footer-left">
    <button
      type="button"
      class="brand-ghost dp-chain__footer-btn"
      data-testid="devplatform-chain-exit"
      @click="emit('skip')"
    >
      <ChevronLeft :size="16" aria-hidden="true" />
      <span>{{ $t('devPlatform.signIn.skip') }}</span>
    </button>
  </Teleport>
</template>

<style scoped>
.dp-chain {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--takeover-gap-md);
  width: 100%;
  height: 100%;
  max-width: 980px;
}

.dp-chain__step {
  width: 100%;
}

/* Positions against the takeover's outer frame — same offsets the other
 * takeover back controls use, so the control does not move between screens. */
.dp-chain__footer-btn {
  position: absolute;
  left: clamp(1.25rem, 2vw, 2rem);
  bottom: clamp(1.25rem, 2vw, 2rem);
  z-index: 2;
  gap: 6px;
}
</style>
