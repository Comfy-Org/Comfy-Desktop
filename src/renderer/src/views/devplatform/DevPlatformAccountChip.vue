<script setup lang="ts">
/** Account identity and authentication controls shown at the dashboard's top-right. */
import { computed, ref } from 'vue'
import { ChevronDown, LogOut } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import DevPlatformAvatar from './DevPlatformAvatar.vue'
import { usePopoverDismiss } from '../../composables/usePopoverDismiss'
import { useAuthStore } from '../../stores/authStore'

const emit = defineEmits<{
  'signed-out': []
}>()

const store = useAuthStore()

const signingIn = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const faceRef = ref<HTMLElement | null>(null)
const email = computed(() => store.status.email ?? '')

const { menuOpen, closeMenu, toggleMenu, onKeydown } = usePopoverDismiss({ rootRef, faceRef })

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
  closeMenu()
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
  <div
    ref="rootRef"
    class="account-chip relative inline-flex flex-col items-end"
    @keydown="onKeydown"
  >
    <template v-if="store.isSignedIn">
      <button
        ref="faceRef"
        type="button"
        class="account-chip__face inline-flex h-7 min-w-0 max-w-80 items-center gap-2 rounded-lg border border-solid border-transparent bg-transparent px-2 py-0 text-neutral-100 text-[length:var(--text-ui)] [--dp-avatar-size:20px] transition-[background,border-color] duration-[120ms] ease-[ease] hover:border-transparent hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] focus-visible:[outline-style:solid] disabled:cursor-wait disabled:opacity-65"
        data-testid="devplatform-account-chip"
        :aria-expanded="menuOpen"
        @click="toggleMenu"
      >
        <DevPlatformAvatar :name="email || '?'" />
        <span
          class="account-chip__email max-w-[200px] truncate font-semibold text-neutral-100 text-[length:var(--text-ui)]"
          >{{ email }}</span
        >
        <ChevronDown
          :size="14"
          class="account-chip__caret flex-none text-neutral-200 transition-transform duration-[140ms] ease-[ease]"
          :class="{ 'account-chip__caret--open rotate-180': menuOpen }"
          aria-hidden="true"
        />
      </button>

      <div
        v-if="menuOpen"
        class="account-chip__menu absolute top-[calc(100%+6px)] right-0 z-20 min-w-[180px] rounded-card border border-solid border-border bg-popover p-1 shadow-popover backdrop-blur-[18px]"
        role="group"
        :aria-label="$t('devPlatform.account.signedInAs', { email })"
        data-testid="devplatform-account-menu"
      >
        <Button
          type="button"
          variant="textonly"
          size="unset"
          class="account-chip__item flex min-h-8 w-full items-center justify-start gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-left font-normal text-neutral-100 text-[length:var(--text-ui)] leading-[inherit] whitespace-normal appearance-auto transition-[background] duration-[120ms] ease-[ease] hover:bg-secondary focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus-ring)] focus-visible:[outline-style:solid]"
          data-testid="devplatform-account-signout"
          @click="onSignOut"
        >
          <LogOut :size="16" aria-hidden="true" />
          <span>{{ $t('devPlatform.account.signOut') }}</span>
        </Button>
      </div>
    </template>
    <Button
      v-else
      type="button"
      variant="inverted"
      size="unset"
      class="account-chip__face account-chip__signin inline-flex h-7 min-w-0 max-w-80 items-center gap-2 rounded-lg border border-solid border-transparent bg-foreground px-2.5 py-0 font-medium text-background text-[length:var(--text-ui)] leading-[inherit] whitespace-normal appearance-auto transition-[background,border-color] duration-[120ms] ease-[ease] hover:enabled:bg-accent-hover disabled:hover:bg-foreground focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] focus-visible:[outline-style:solid] disabled:pointer-events-auto disabled:cursor-wait disabled:opacity-65"
      data-testid="devplatform-account-signin"
      :disabled="signingIn"
      @click="onSignIn"
    >
      {{ $t('devPlatform.signIn.cta') }}
    </Button>
  </div>
</template>
