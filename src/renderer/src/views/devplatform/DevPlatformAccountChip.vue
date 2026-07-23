<script setup lang="ts">
/**
 * Account chip: persistent identity, top-right (the Docker Desktop pattern).
 *
 * Signed out it is one quiet log-in button that runs the browser handoff
 * itself. Signed in it names the account AND the workspace on the chip face:
 * a token carries exactly one workspace claim, so everything downstream
 * belongs to whichever workspace this chip names; keeping it visible makes a
 * wrong-workspace mistake self-correcting.
 *
 * The dropdown is a WORKSPACE SWITCHER: it lists the account's workspaces and
 * switches the active one. A cloud PKCE token is scoped at consent time, so a
 * switch re-runs the browser handoff pre-selecting the workspace (there is no
 * silent re-scope); the chip shows a spinner on the row while that is out.
 *
 * Sign out confirms, because users reasonably fear it uninstalls what they
 * installed. It does not: the confirm body says exactly that. Tone stays
 * primary, never danger.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, Loader2, LogIn, LogOut } from 'lucide-vue-next'
import DevPlatformAvatar from './DevPlatformAvatar.vue'
import { useAuthStore } from '../../stores/authStore'
import { useDialogs } from '../../composables/useDialogs'

const emit = defineEmits<{
  /** Sign-out completed. Host decides whether anything else changes. */
  'signed-out': []
  /** The active workspace changed. Host re-pulls workspace-scoped data. */
  'workspace-switched': []
}>()

const { t } = useI18n()
const store = useAuthStore()
const dialogs = useDialogs()

const menuOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const faceRef = ref<HTMLElement | null>(null)
const signingIn = ref(false)
/** Workspace id currently being switched to, or null. Drives the row spinner
 *  and blocks a second concurrent switch. */
const switchingTo = ref<string | null>(null)

const email = computed(() => store.status.email ?? '')

/**
 * The workspace named by the access token's single claim. Team ids double as
 * the display name (the claims carry no human name: backend gap); personal
 * workspaces are named by the product.
 */
const workspaceName = computed(() => {
  const s = store.status
  if (!s.signedIn) return ''
  if (s.workspaceType === 'team' && s.workspaceId) return s.workspaceId
  return t('devPlatform.workspace.personalLabel')
})

/** Human label for one workspace row. Personal workspaces get the product name. */
function workspaceLabel(ws: { name: string; type: string }): string {
  if (ws.type === 'team') return ws.name
  return t('devPlatform.workspace.personalLabel')
}

const currentWorkspaceId = computed(() => store.status.workspaceId ?? null)

function closeMenu(): void {
  menuOpen.value = false
}

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
  // Opening the menu is when the switcher needs its list: pull it lazily so a
  // signed-in user who never opens the menu never makes the call.
  if (menuOpen.value && store.workspaces.length === 0) {
    void store.fetchWorkspaces().catch(() => {})
  }
}

/** Escape closes the menu wherever focus is: the menu is never a trap.
 *  Focus returns to the trigger (APG menu pattern); pointer dismissal
 *  deliberately doesn't refocus: that would steal focus from wherever
 *  the user just clicked. */
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
    // Cancelled or failed browser handoff: the button simply re-arms.
  } finally {
    signingIn.value = false
  }
}

async function onSelectWorkspace(workspaceId: string): Promise<void> {
  // Already the active workspace, or a switch is already in flight.
  if (workspaceId === currentWorkspaceId.value || switchingTo.value) return
  switchingTo.value = workspaceId
  try {
    await store.switchWorkspace(workspaceId)
    closeMenu()
    emit('workspace-switched')
  } catch {
    // Cancelled or failed re-auth: the current workspace is unchanged.
  } finally {
    switchingTo.value = null
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
  try {
    await store.signOut()
  } catch {
    // Sign-out IPC failed: stay visibly signed in rather than lie.
    return
  }
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
        ref="faceRef"
        type="button"
        class="account-chip__face"
        data-testid="devplatform-account-chip"
        :aria-expanded="menuOpen"
        aria-haspopup="menu"
        @click="toggleMenu"
      >
        <!-- Seeded from the workspace, not the account: the avatar reads as
             "which workspace am I in", matching the rows in the menu. -->
        <DevPlatformAvatar class="account-chip__avatar" :name="workspaceName || email || '?'" />
        <!-- Account over workspace. The workspace needs no label: the avatar
             beside it is the workspace's, so the second line reads as one. -->
        <span class="account-chip__identity">
          <span class="account-chip__email">{{ email }}</span>
          <span v-if="workspaceName" class="account-chip__workspace-name">{{ workspaceName }}</span>
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
        <p class="account-chip__section-label">{{ $t('devPlatform.workspace.switchLabel') }}</p>

        <div v-if="store.loadingWorkspaces && store.workspaces.length === 0" class="account-chip__hint">
          {{ $t('common.loading') }}
        </div>

        <button
          v-for="ws in store.workspaces"
          :key="ws.id"
          type="button"
          class="account-chip__item account-chip__workspace-item"
          role="menuitemradio"
          :aria-checked="ws.id === currentWorkspaceId"
          :disabled="switchingTo !== null"
          :data-testid="`devplatform-workspace-${ws.id}`"
          @click="onSelectWorkspace(ws.id)"
        >
          <DevPlatformAvatar class="account-chip__item-avatar" :name="workspaceLabel(ws)" />
          <span class="account-chip__item-identity">
            <span class="account-chip__item-name">{{ workspaceLabel(ws) }}</span>
            <span v-if="ws.subscriptionTier" class="account-chip__item-sub">{{ ws.subscriptionTier }}</span>
          </span>
          <Loader2
            v-if="switchingTo === ws.id"
            :size="15"
            class="account-chip__spinner"
            aria-hidden="true"
          />
          <Check
            v-else-if="ws.id === currentWorkspaceId"
            :size="15"
            class="account-chip__item-check"
            aria-hidden="true"
          />
        </button>

        <div class="account-chip__divider" role="separator"></div>

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
   truncated out of existence on a narrow window. Shares the 6px radius of
   `button.brand-tertiary`: the signed-out control that occupies this same
   slot: so the two states of one affordance keep one silhouette. */
.account-chip__face {
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

/* The avatar is the square gradient one, seeded from the account email so the
   same person renders in the same colour here and on the web frontend. */
.account-chip__avatar {
  --dp-avatar-size: 30px;
}

.account-chip__identity {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  min-width: 0;
  font-size: var(--takeover-fs-caption);
  line-height: 1.3;
}
.account-chip__email {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: var(--neutral-100);
}
.account-chip__workspace-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--neutral-200);
}

.account-chip__caret {
  flex: 0 0 auto;
  color: var(--neutral-200);
  transition: transform 140ms ease;
}
.account-chip__caret--open {
  transform: rotate(180deg);
}

/* Dropdown: anchored to the chip's top-right, opening downward. */
.account-chip__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  min-width: 240px;
  max-width: 320px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--brand-surface-border);
  background: var(--chooser-surface-bg);
  backdrop-filter: blur(18px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
}

.account-chip__section-label {
  margin: 4px 8px 6px;
  font-size: var(--takeover-fs-caption);
  font-weight: 600;
  color: var(--neutral-200);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.account-chip__hint {
  padding: 8px;
  font-size: var(--takeover-fs-caption);
  color: var(--neutral-200);
  opacity: 0.8;
}

.account-chip__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--neutral-100);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}
.account-chip__item:hover:not(:disabled) {
  background: var(--brand-surface-bg-hover);
}
.account-chip__item:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}
.account-chip__item:disabled {
  cursor: default;
}

.account-chip__workspace-item {
  gap: 10px;
}
.account-chip__item-avatar {
  --dp-avatar-size: 26px;
}
.account-chip__item-identity {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1 1 auto;
}
.account-chip__item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--takeover-fs-body);
}
.account-chip__item-sub {
  font-size: var(--takeover-fs-caption);
  color: var(--neutral-200);
  text-transform: capitalize;
}
.account-chip__item-check {
  flex: 0 0 auto;
  color: var(--comfy-yellow);
}

.account-chip__divider {
  height: 1px;
  margin: 6px 4px;
  background: var(--brand-surface-border);
}
</style>
