<script setup lang="ts">
/** Account identity and authentication controls shown at the dashboard's top-right. */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronDown, LogOut } from 'lucide-vue-next'
import DevPlatformAvatar from './DevPlatformAvatar.vue'
import { useAuthStore } from '../../stores/authStore'

const emit = defineEmits<{
  'signed-out': []
}>()

const store = useAuthStore()

const menuOpen = ref(false)
const signingIn = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const faceRef = ref<HTMLElement | null>(null)
const email = computed(() => store.status.email ?? '')

function closeMenu(): void {
  menuOpen.value = false
}

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && menuOpen.value) {
    e.stopPropagation()
    closeMenu()
    faceRef.value?.focus()
  }
}

function onPointerDown(e: MouseEvent): void {
  if (!menuOpen.value) return
  const target = e.target as Node | null
  if (target && rootRef.value?.contains(target)) return
  closeMenu()
}

onMounted(() => {
  document.addEventListener('mousedown', onPointerDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onPointerDown)
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
  closeMenu()
  try {
    await store.signOut()
  } catch {
    return
  }
  emit('signed-out')
}
</script>

<template>
  <div ref="rootRef" class="account-chip" @keydown="onKeydown">
    <template v-if="store.isSignedIn">
      <button
        ref="faceRef"
        type="button"
        class="account-chip__face"
        data-testid="devplatform-account-chip"
        :aria-expanded="menuOpen"
        @click="toggleMenu"
      >
        <DevPlatformAvatar :name="email || '?'" />
        <span class="account-chip__email">{{ email }}</span>
        <ChevronDown
          :size="14"
          class="account-chip__caret"
          :class="{ 'account-chip__caret--open': menuOpen }"
          aria-hidden="true"
        />
      </button>

      <div
        v-if="menuOpen"
        class="account-chip__menu"
        role="group"
        :aria-label="$t('devPlatform.account.signedInAs', { email })"
        data-testid="devplatform-account-menu"
      >
        <button
          type="button"
          class="account-chip__item"
          data-testid="devplatform-account-signout"
          @click="onSignOut"
        >
          <LogOut :size="16" aria-hidden="true" />
          <span>{{ $t('devPlatform.account.signOut') }}</span>
        </button>
      </div>
    </template>
    <button
      v-else
      type="button"
      class="account-chip__face account-chip__signin"
      data-testid="devplatform-account-signin"
      :disabled="signingIn"
      @click="onSignIn"
    >
      {{ $t('devPlatform.signIn.cta') }}
    </button>
  </div>
</template>

<style scoped>
.account-chip {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
}

.account-chip__face {
  --dp-avatar-size: calc(var(--takeover-fs-caption) * 2.5);
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 320px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid color-mix(in oklab, var(--neutral-100) 10%, transparent);
  background: color-mix(in oklab, var(--neutral-100) 5%, transparent);
  color: var(--neutral-100);
  font: inherit;
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease;
}
.account-chip__face:hover {
  background: color-mix(in oklab, var(--neutral-100) 10%, transparent);
  border-color: color-mix(in oklab, var(--neutral-100) 18%, transparent);
}
.account-chip__face:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.account-chip__face:disabled {
  cursor: wait;
  opacity: 0.65;
}

.account-chip__signin {
  padding-inline: 16px;
  font-size: var(--takeover-fs-caption);
  font-weight: 600;
}

.account-chip__email {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--neutral-100);
  font-size: var(--takeover-fs-caption);
  font-weight: 600;
}

.account-chip__caret {
  flex: 0 0 auto;
  color: var(--neutral-200);
  transition: transform 140ms ease;
}
.account-chip__caret--open {
  transform: rotate(180deg);
}

.account-chip__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  min-width: 180px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--brand-surface-border);
  background: var(--chooser-surface-bg);
  backdrop-filter: blur(18px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
}

.account-chip__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--neutral-100);
  font: inherit;
  font-size: var(--takeover-fs-caption);
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}
.account-chip__item:hover {
  background: var(--brand-surface-bg-hover);
}
.account-chip__item:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}
</style>
