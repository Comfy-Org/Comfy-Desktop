<script setup lang="ts">
/**
 * DevPlatformChain — sign-in → workspace. Two screens, no more.
 *
 * Completing the workspace step ends first-use outright: there is no
 * distribution step here, because the org's distributions appear as ordinary
 * chooser tiles on the dashboard the user lands on. `complete` is that exit —
 * the host maps it to mark-completed + dismiss.
 *
 * The chain renders layout-less: FirstUseTakeover already owns a
 * `BrandTakeoverLayout`, and a second one would replay the entrance animation
 * on every start ⇄ chain crossing. The footer Skip teleports into an anchor
 * the parent exposes inside its layout's `footer-left` slot (`defer` because
 * that slot is patched after this subtree on first render).
 *
 * `open()` is the reset — constructor state is never trusted for takeover
 * content, same rule the host applies to FirstUseTakeover itself.
 */
import { ref } from 'vue'
import { ChevronLeft } from 'lucide-vue-next'
import DevPlatformSignInStep from './DevPlatformSignInStep.vue'
import DevPlatformWorkspaceStep from './DevPlatformWorkspaceStep.vue'
import { useAuthStore } from '../../stores/authStore'

const emit = defineEmits<{
  /** Sign-in AND workspace selection are both done — the host ends first-use. */
  complete: []
  /** The user opted out of signing in; the host returns to the start screen. */
  skip: []
}>()

const store = useAuthStore()

type Step = 'signin' | 'workspace'
const step = ref<Step>('signin')

/** Host-callable reset. An existing session has no browser handoff left to do,
 *  so it starts on the workspace screen. */
function open(): void {
  if (!store.isSignedIn) {
    // Also invalidates any sign-in abandoned mid-wait on a previous entry.
    store.cancelSignIn()
    step.value = 'signin'
    return
  }
  step.value = 'workspace'
}

function onSignedIn(): void {
  step.value = 'workspace'
}

function onWorkspaceSelected(workspaceId: string): void {
  store.selectWorkspace(workspaceId)
  emit('complete')
}

defineExpose({ open })
</script>

<template>
  <div class="dp-chain">
    <DevPlatformSignInStep
      v-if="step === 'signin'"
      class="dp-chain__step"
      @signed-in="onSignedIn"
      @skip="emit('skip')"
    />
    <DevPlatformWorkspaceStep
      v-else
      class="dp-chain__step"
      @selected="onWorkspaceSelected"
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
