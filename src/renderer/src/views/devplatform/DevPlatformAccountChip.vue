<script setup lang="ts">
/**
 * Account chip: persistent identity, top-right (the Docker Desktop pattern).
 *
 * Signed out it renders NOTHING — logging in lives in the title-bar file menu
 * and nowhere else, so the dashboard shows no account affordance until there
 * is an account to show. Signed in it names the account AND the workspace on
 * the chip face: a token carries exactly one workspace claim, so everything
 * downstream belongs to whichever workspace this chip names; keeping it
 * visible makes a wrong-workspace mistake self-correcting.
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
import { Check, ChevronDown, Loader2, LogOut } from 'lucide-vue-next'
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
/** Workspace id currently being switched to, or null. Drives the row spinner
 *  and blocks a second concurrent switch. */
const switchingTo = ref<string | null>(null)

const email = computed(() => store.status.email ?? '')

/**
 * The workspace named by the access token's single claim. For a team we prefer
 * the human name from the loaded workspace list so the chip face matches the
 * switcher row (same label AND same seeded avatar colour); the raw id is only a
 * fallback until the list loads (the claims carry no human name: backend gap).
 * Personal workspaces are named by the product.
 */
const workspaceName = computed(() => {
  const s = store.status
  if (!s.signedIn) return ''
  if (s.workspaceType === 'team' && s.workspaceId) {
    return store.workspaces.find((w) => w.id === s.workspaceId)?.name ?? s.workspaceId
  }
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
    <!-- Signed out renders nothing at all: the file menu's "Log in" is the
         app's only sign-in affordance. -->
    <template v-if="store.isSignedIn">
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
        <DevPlatformAvatar :name="workspaceName || email || '?'" />
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
        <!-- Failed load (not just empty): offer a retry rather than a blank switcher. -->
        <button
          v-else-if="store.workspacesError && store.workspaces.length === 0"
          type="button"
          class="account-chip__item account-chip__retry"
          role="menuitem"
          data-testid="devplatform-workspace-retry"
          @click="store.fetchWorkspaces()"
        >
          {{ $t('devPlatform.workspace.loadError') }}
        </button>

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
          <DevPlatformAvatar :name="workspaceLabel(ws)" />
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

.account-chip__spinner {
  animation: account-chip-spin 900ms linear infinite;
}
@keyframes account-chip-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Chip face: frosted, quiet, and two-line so the workspace never has to be
   truncated out of existence on a narrow window. Keeps the 6px radius of
   `button.brand-tertiary` so it sits in the same visual family as the rest of
   the dashboard's quiet controls. */
.account-chip__face {
  display: inline-flex;
  align-items: center;
  max-width: 320px;
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

/* Avatar-plus-two-lines, shared by the chip face and every switcher row: a
   switcher row IS the face restated, so both are sized off one spec.
   The avatar is the square gradient one, seeded from the workspace name (the
   account email only as a fallback), so it reads as "which workspace am I in"
   and matches the seeded colour of the active row in the switcher.
   Its size is 2.5x the caption size, which is exactly the two 1.2-line-height
   lines beside it: the text block and the avatar are the same height at every
   step of the fluid scale, so neither ever overhangs the other. */
.account-chip__face,
.account-chip__workspace-item {
  --dp-avatar-size: calc(var(--takeover-fs-caption) * 2.5);
  gap: 10px;
  padding: 6px 10px;
}

.account-chip__identity,
.account-chip__item-identity {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  min-width: 0;
  height: var(--dp-avatar-size);
  font-size: var(--takeover-fs-caption);
  line-height: 1.2;
}

.account-chip__email,
.account-chip__workspace-name,
.account-chip__item-name,
.account-chip__item-sub {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-chip__email,
.account-chip__item-name {
  font-weight: 600;
  color: var(--neutral-100);
}
.account-chip__workspace-name,
.account-chip__item-sub {
  color: var(--neutral-200);
}
/* The face is inline: it grows with its text up to this cap, where the rows
   are full-width and truncate against the check instead. */
.account-chip__email,
.account-chip__workspace-name {
  max-width: 200px;
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
  /* Cap the height so a user in many workspaces can always reach Sign out. */
  max-height: min(70vh, 480px);
  overflow-y: auto;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--brand-surface-border);
  background: var(--chooser-surface-bg);
  backdrop-filter: blur(18px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
}

.account-chip__section-label {
  margin: 4px 10px 6px;
  font-size: var(--takeover-fs-caption);
  font-weight: 600;
  color: var(--neutral-200);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.account-chip__hint {
  padding: 6px 10px;
  font-size: var(--takeover-fs-caption);
  color: var(--neutral-200);
  opacity: 0.8;
}

.account-chip__retry {
  color: var(--neutral-200);
}

/* Every row shares the face's 10px inset so avatars and icons start on one
   left edge, and its caption size so no row outweighs a workspace name. */
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

/* Takes the rest of the row so a long workspace name truncates against the
   check/spinner rather than pushing it out of the menu. */
.account-chip__item-identity {
  flex: 1 1 auto;
}
.account-chip__item-sub {
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
