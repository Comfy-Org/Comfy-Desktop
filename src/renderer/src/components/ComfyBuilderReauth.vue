<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useAuthStore } from '../stores/authStore'

const emit = defineEmits<{ recovered: [] }>()

const { t } = useI18n()
const authStore = useAuthStore()

// Only prompt on a mid-flow expiry: a user who was never signed in this flow
// sees the pipeline sign-in sentinel instead, so track whether they were ever
// signed in and show this "session expired" prompt only after that flips false.
const wasSignedIn = ref(authStore.isSignedIn)
watch(
  () => authStore.isSignedIn,
  (signedIn) => {
    if (signedIn) wasSignedIn.value = true
  }
)

// Read isSignedIn unconditionally (not short-circuited behind wasSignedIn) so
// the computed always tracks it and re-shows the prompt the moment it flips false.
const showReauth = computed(() => {
  const signedIn = authStore.isSignedIn
  return wasSignedIn.value && !signedIn
})

const signingIn = ref(false)
async function reauth(): Promise<void> {
  if (signingIn.value) return
  signingIn.value = true
  try {
    const status = await authStore.signIn()
    if (status.signedIn) emit('recovered')
  } catch {
    // Cancelled or failed browser handoff — the button simply re-arms.
  } finally {
    signingIn.value = false
  }
}
</script>

<template>
  <div v-if="showReauth" data-testid="cb-reauth" class="cb-reauth" role="alert">
    <span class="cb-reauth__message">{{ t('devPlatform.reauth.sessionExpired') }}</span>
    <button
      type="button"
      class="brand-primary cb-reauth__signin"
      data-testid="cb-reauth-signin"
      :disabled="signingIn"
      @click="reauth"
    >
      {{ t('devPlatform.reauth.signIn') }}
    </button>
  </div>
</template>

<style scoped>
.cb-reauth {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 8px;
  color: var(--warning);
  background: color-mix(in oklab, var(--warning) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--warning) 28%, transparent);
  text-align: left;
}
.cb-reauth__message {
  font-size: 13px;
  line-height: 1.4;
}
.cb-reauth__signin {
  flex: 0 0 auto;
  height: 30px;
  padding-inline: 14px;
  font-size: 13px;
}
.cb-reauth__signin:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
