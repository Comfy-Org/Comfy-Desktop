<script setup lang="ts">
/**
 * Account chip — persistent identity, top-right (the Docker Desktop pattern).
 *
 * Signed out it is one quiet log-in button that runs the browser handoff
 * itself. Signed in it names the account AND the workspace on the chip face —
 * a token carries exactly one workspace claim, so everything downstream
 * belongs to whichever workspace this chip names; keeping it visible makes a
 * wrong-workspace mistake self-correcting.
 *
 * Sign out confirms, because users reasonably fear it uninstalls what they
 * installed. It does not — the confirm body says exactly that. Tone stays
 * primary, never danger.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Loader2, LogIn, LogOut, User } from 'lucide-vue-next'
import { useAuthStore } from '../../stores/authStore'
import { useDialogs } from '../../composables/useDialogs'

const emit = defineEmits<{
  /** Sign-out completed. Host decides whether anything else changes. */
  'signed-out': []
}>()

const { t } = useI18n()
const store = useAuthStore()
const dialogs = useDialogs()

const menuOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const signingIn = ref(false)

const email = computed(() => store.status.email ?? '')
const workspaceName = computed(() => store.activeWorkspace?.name ?? '')

function closeMenu(): void {
  menuOpen.value = false
}

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
}

/** Escape closes the menu wherever focus is — the menu is never a trap. */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && menuOpen.value) {
    e.stopPropagation()
    closeMenu()
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
    // Cancelled or failed browser handoff — the button simply re-arms.
  } finally {
    signingIn.value = false
  }
}

async function onSignOut(): Promise<void> {
  closeMenu()
  const result = await dialogs.confirm({
    title: t('devPlatform.account.signOutConfirmTitle'),
    // States plainly that installed distributions are KEPT and only stop
    // receiving updates. This is the sentence that stops the support ticket.
    message: t('devPlatform.account.signOutConfirmBody'),
    confirmLabel: t('devPlatform.account.signOutConfirmCta'),
    tone: 'primary',
  })
  if (result !== 'primary') return
  await store.signOut()
  emit('signed-out')
}
</script>

<template>
  <div ref="rootRef" class="account-chip" @keydown="onKeydown">
    <!-- Signed out: one quiet button. Deliberately not the yellow primary. -->
    <button
      v-if="!store.isSignedIn"
      type="button"
      class="brand-tertiary account-chip__signin"
      data-testid="devplatform-account-signin"
      :disabled="signingIn"
      :aria-busy="signingIn"
      @click="onSignIn"
    >
      <Loader2 v-if="signingIn" :size="16" class="account-chip__spinner" aria-hidden="true" />
      <LogIn v-else :size="16" aria-hidden="true" />
      <span>{{ $t('devPlatform.signIn.cta') }}</span>
    </button>

    <template v-else>
      <button
        type="button"
        class="account-chip__face"
        data-testid="devplatform-account-chip"
        :aria-expanded="menuOpen"
        aria-haspopup="menu"
        @click="toggleMenu"
      >
        <span class="account-chip__avatar" aria-hidden="true">
          <User :size="14" />
        </span>
        <span class="account-chip__identity">
          <span class="account-chip__email">{{ email }}</span>
          <!-- Workspace identity is persistently visible, not menu-only. -->
          <span v-if="workspaceName" class="account-chip__workspace">
            <span class="account-chip__workspace-label">
              {{ $t('devPlatform.account.workspaceLabel') }}
            </span>
            <span class="account-chip__workspace-name">{{ workspaceName }}</span>
          </span>
        </span>
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
        role="menu"
        :aria-label="$t('devPlatform.account.signedInAs', { email })"
        data-testid="devplatform-account-menu"
      >
        <button
          type="button"
          class="account-chip__item"
          role="menuitem"
          data-testid="devplatform-account-signout"
          @click="onSignOut"
        >
          <LogOut :size="16" aria-hidden="true" />
          <span>{{ $t('devPlatform.account.signOut') }}</span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.account-chip {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
}

.account-chip__signin {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.account-chip__spinner {
  animation: account-chip-spin 900ms linear infinite;
}
@keyframes account-chip-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Chip face: frosted, quiet, and two-line so the workspace never has to be
   truncated out of existence on a narrow window. */
.account-chip__face {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 320px;
  padding: 6px 10px;
  border-radius: 999px;
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

.account-chip__avatar {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--neutral-100) 10%, transparent);
  color: var(--neutral-100);
}

.account-chip__identity {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  min-width: 0;
  text-align: left;
}
.account-chip__email {
  font-size: var(--takeover-fs-caption);
  line-height: 1.3;
  color: var(--neutral-100);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-chip__workspace {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  font-size: var(--takeover-fs-caption);
  line-height: 1.3;
}
.account-chip__workspace-label {
  color: var(--neutral-300);
}
.account-chip__workspace-name {
  color: var(--neutral-100);
  font-weight: 600;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-chip__caret {
  flex: 0 0 auto;
  color: var(--neutral-300);
  transition: transform 120ms ease;
}
.account-chip__caret--open {
  transform: rotate(180deg);
}

.account-chip__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  min-width: 220px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--neutral-100) 10%, transparent);
  background: var(--neutral-800);
  box-shadow: 0 12px 32px color-mix(in oklab, var(--neutral-950) 55%, transparent);
  animation: account-chip-menu-in 140ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes account-chip-menu-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.account-chip__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--neutral-100);
  font: inherit;
  font-size: var(--takeover-fs-body);
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}
.account-chip__item:hover {
  background: color-mix(in oklab, var(--neutral-100) 8%, transparent);
}
.account-chip__item:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .account-chip__face,
  .account-chip__caret,
  .account-chip__item {
    transition: none;
  }
  .account-chip__menu {
    animation: none;
  }
  .account-chip__spinner {
    animation: none;
  }
}
</style>
