<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Cloud, TriangleAlert } from 'lucide-vue-next'
import Button from '../../design-system/components/Button.vue'
import EmptyState from '../../design-system/components/EmptyState.vue'
import { useAuthStore } from '../../stores/authStore'

/** What a build's tab shows instead of its list when it cannot list: signed
 *  out of Comfy Cloud (with Log in), or an error (with Retry). */
const { error, signedOut } = defineProps<{ error: string | null; signedOut: boolean }>()
const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()
const authStore = useAuthStore()
const signingIn = ref(false)

async function logIn(): Promise<void> {
  signingIn.value = true
  try {
    await authStore.signIn()
  } catch {
    // The browser flow reports its own errors.
  } finally {
    signingIn.value = false
  }
}
</script>

<template>
  <EmptyState
    v-if="signedOut"
    :icon="Cloud"
    :title="t('buildsDashboard.contents.signedOutTitle')"
    :description="t('buildsDashboard.contents.signedOutDescription')"
    class="mt-4"
  >
    <Button variant="primary" :disabled="signingIn" @click="logIn">{{
      t('devPlatform.signIn.cta')
    }}</Button>
  </EmptyState>
  <EmptyState
    v-else-if="error"
    :icon="TriangleAlert"
    :title="t('buildsDashboard.contents.errorTitle')"
    :description="error"
    class="mt-4"
  >
    <Button @click="emit('retry')">{{ t('buildsDashboard.retry') }}</Button>
  </EmptyState>
</template>
