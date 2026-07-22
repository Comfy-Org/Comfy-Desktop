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
import { Check, ChevronDown, Loader2, LogIn, LogOut } from 'lucide-vue-next'
import DevPlatformAvatar from './DevPlatformAvatar.vue'
import { useAuthStore } from '../../stores/authStore'
import { useDialogs } from '../../composables/useDialogs'
import type { Workspace } from '../../devplatform/types'

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

/**
 * Workspaces offered by the dropdown's switcher.
 *
 * BACKEND GAP — this list is derived from the ONE workspace claim on the
 * current access token, so it can only ever hold a single entry today. Users
 * routinely belong to a personal workspace AND one or more team workspaces at
 * once (the web platform already ships a switcher for exactly this), but
 * Desktop has no way to see the others: there is no list-workspaces endpoint,
 * and no token re-scope endpoint to switch to one. Both need building before
 * this control can do its job — until then it truthfully shows the workspace
 * you are in, and selecting it is a no-op.
 */
const workspaces = computed<Workspace[]>(() => store.workspaces)
const activeWorkspaceId = computed(() => store.activeWorkspace?.id)

function workspaceMeta(ws: Workspace): string {
  if (ws.type === 'personal') return t('devPlatform.workspace.personalLabel')
  return ws.role === 'owner'
    ? t('devPlatform.workspace.roleOwner')
    : t('devPlatform.workspace.roleMember')
}

function onSelectWorkspace(ws: Workspace): void {
  // Re-scoping the session to another workspace needs a backend that does not
  // exist yet (see the note above), so picking the active one just closes.
  store.selectWorkspace(ws.id)
  closeMenu()
}

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
        <DevPlatformAvatar class="account-chip__avatar" :name="email || '?'" />
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
        <!-- Workspace switcher. Single-entry until the backend can list and
             re-scope workspaces — see the note on `workspaces`. -->
        <p class="account-chip__section">{{ $t('devPlatform.account.workspaceLabel') }}</p>
        <button
          v-for="ws in workspaces"
          :key="ws.id"
          type="button"
          class="account-chip__item account-chip__ws"
          role="menuitemradio"
          :aria-checked="ws.id === activeWorkspaceId"
          :data-testid="`devplatform-account-workspace-${ws.id}`"
          @click="onSelectWorkspace(ws)"
        >
          <DevPlatformAvatar class="account-chip__ws-avatar" :name="ws.name" />
          <span class="account-chip__ws-text">
            <span class="account-chip__ws-name">{{ ws.name }}</span>
            <span class="account-chip__ws-meta">{{ workspaceMeta(ws) }}</span>
          </span>
          <Check
            v-if="ws.id === activeWorkspaceId"
            :size="16"
            class="account-chip__ws-check"
            aria-hidden="true"
          />
        </button>

        <span class="account-chip__divider" aria-hidden="true" />

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
   `button.brand-tertiary` — the signed-out control that occupies this same
   slot — so the two states of one affordance keep one silhouette. */
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
  --dp-avatar-size: 24px;
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

/* Section label above the workspace rows — a quiet caption, not a control. */
.account-chip__section {
  margin: 2px 0 4px;
  padding: 0 10px;
  font-size: var(--takeover-fs-caption);
  color: var(--neutral-300);
}

.account-chip__divider {
  display: block;
  height: 1px;
  margin: 6px 0;
  background: color-mix(in oklab, var(--neutral-100) 10%, transparent);
}

/* Workspace row: avatar → name over role → trailing check on the active one.
   The check IS the selection cue; there is no leading radio dot. */
.account-chip__ws {
  --dp-avatar-size: 24px;
  align-items: center;
}
.account-chip__ws-text {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  text-align: left;
}
.account-chip__ws-name {
  font-size: var(--takeover-fs-body);
  line-height: 1.3;
  color: var(--neutral-100);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-chip__ws-meta {
  font-size: var(--takeover-fs-caption);
  line-height: 1.3;
  color: var(--neutral-300);
}
.account-chip__ws-check {
  flex: 0 0 auto;
  color: var(--neutral-100);
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
