<script setup lang="ts">
/** Account identity and authentication controls shown at the dashboard's top-right. */
import { computed, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import { ChevronDown, LogOut } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import DevPlatformAvatar from './DevPlatformAvatar.vue'
import { useAuthStore } from '../../stores/authStore'

const emit = defineEmits<{
  'signed-out': []
}>()

const store = useAuthStore()

const signingIn = ref(false)
const email = computed(() => store.status.email ?? '')

const menuOpen = ref(false)
useEventListener(window, 'blur', () => {
  menuOpen.value = false
})

async function onSignIn(): Promise<void> {
  if (signingIn.value) return
  signingIn.value = true
  try {
    await store.signIn()
  } catch {
    return
  } finally {
    signingIn.value = false
  }
}

async function onSignOut(): Promise<void> {
  menuOpen.value = false
  try {
    await store.signOut()
  } catch {
    return
  }
  if (store.isSignedIn) return
  emit('signed-out')
}
</script>

<template>
  <div class="account-chip relative inline-flex flex-col items-end">
    <Menu
      v-if="store.isSignedIn"
      v-model:open="menuOpen"
      :modal="false"
      align="end"
      class="account-chip__menu z-20 min-w-[180px]"
      :aria-label="$t('devPlatform.account.signedInAs', { email })"
      data-testid="devplatform-account-menu"
    >
      <template #trigger>
        <Button
          variant="textonly"
          size="md"
          class="account-chip__face min-w-0 max-w-80 [--dp-avatar-size:20px]"
          data-testid="devplatform-account-chip"
        >
          <DevPlatformAvatar :name="email || '?'" />
          <span class="account-chip__email max-w-[200px] truncate">{{ email }}</span>
          <ChevronDown
            :size="14"
            class="account-chip__caret shrink-0 transition-transform"
            :class="{ 'account-chip__caret--open rotate-180': menuOpen }"
            aria-hidden="true"
          />
        </Button>
      </template>
      <MenuItem
        as="button"
        type="button"
        class="account-chip__item w-full"
        data-testid="devplatform-account-signout"
        @select="onSignOut"
      >
        <LogOut :size="16" aria-hidden="true" />
        <span>{{ $t('devPlatform.account.signOut') }}</span>
      </MenuItem>
    </Menu>
    <Button
      v-else
      type="button"
      variant="inverted"
      size="md"
      class="account-chip__face account-chip__signin min-w-0 max-w-80"
      data-testid="devplatform-account-signin"
      :disabled="signingIn"
      @click="onSignIn"
      >{{ $t('devPlatform.signIn.cta') }}</Button
    >
  </div>
</template>
