<script setup lang="ts">
/**
 * Workspace selection step. A port of the web frontend's OAuth-consent
 * workspace picker (32px avatar → name over a secondary line → trailing check
 * on the selected row), translated from Tailwind to scoped CSS + tokens.
 *
 * With ONE workspace there is no picker: the token's auto-selected workspace
 * renders as a static summary row (same anatomy, no affordances) and the
 * screen becomes a confirmation. Today the token always carries exactly one
 * workspace, so the radiogroup path is dormant until a list endpoint exists.
 *
 * Backward navigation lives in the chain's footer; this step only exposes its
 * forward commit.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from 'lucide-vue-next'
import DevPlatformWorkspaceAvatar from './DevPlatformWorkspaceAvatar.vue'
import { useAuthStore } from '../../stores/authStore'
import type { Workspace } from '../../devplatform/types'

const emit = defineEmits<{
  selected: [workspaceId: string]
}>()

const { t } = useI18n()
const store = useAuthStore()

const workspaces = computed<Workspace[]>(() => store.workspaces)

/** Seeded from the store so re-entering shows the current selection. */
const selectedId = ref<string | undefined>(store.activeWorkspaceId)

watch(
  () => store.activeWorkspaceId,
  (id) => {
    if (id) selectedId.value = id
  }
)

const showPicker = computed(() => store.needsWorkspaceChoice)

/** With the picker suppressed the lone workspace IS the answer. */
const committedId = computed<string | undefined>(
  () => selectedId.value ?? (showPicker.value ? undefined : workspaces.value[0]?.id)
)

const soleWorkspace = computed<Workspace | undefined>(
  () => workspaces.value.find((w) => w.id === committedId.value) ?? workspaces.value[0]
)

const canContinue = computed(() => committedId.value !== undefined)

const listEl = ref<HTMLElement | null>(null)

/** With no picker, "Choose a workspace" would be a lie — confirm identity instead. */
const heroTitle = computed(() => {
  if (showPicker.value) return t('devPlatform.workspace.title')
  const email = store.status.email
  return email ? t('devPlatform.signIn.successTitle', { email }) : t('devPlatform.workspace.title')
})
const heroLead = computed(() =>
  showPicker.value ? t('devPlatform.workspace.lead') : t('devPlatform.signIn.explainerBody')
)

/** Personal workspaces state their kind; team workspaces state the role,
 *  which is the fact that differs between two team rows. */
function secondaryLabel(ws: Workspace): string {
  if (ws.type === 'personal') return t('devPlatform.workspace.personalLabel')
  return ws.role === 'owner'
    ? t('devPlatform.workspace.roleOwner')
    : t('devPlatform.workspace.roleMember')
}

/** Roving tabindex — exactly one radio in the group is tabbable. */
function rowTabIndex(ws: Workspace, index: number): number {
  if (selectedId.value === undefined) return index === 0 ? 0 : -1
  return selectedId.value === ws.id ? 0 : -1
}

/** WAI-ARIA APG radiogroup arrows — the `onStartCardsKeydown` pattern from
 *  FirstUseTakeover.vue, walking the live workspace list. */
function onWorkspaceKeydown(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null
  if (!target?.closest('[role="radio"]')) return
  const order = workspaces.value.map((w) => w.id)
  if (order.length === 0) return
  const currentIndex = selectedId.value === undefined ? -1 : order.indexOf(selectedId.value)
  let next: number
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    next = currentIndex < 0 ? 0 : (currentIndex + 1) % order.length
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    next = currentIndex < 0 ? order.length - 1 : (currentIndex - 1 + order.length) % order.length
  } else {
    return
  }
  const nextChoice = order[next]
  if (!nextChoice) return
  e.preventDefault()
  selectedId.value = nextChoice
  void nextTick(() => {
    const radios = listEl.value?.querySelectorAll<HTMLElement>('[role="radio"]')
    radios?.[next]?.focus()
  })
}

function onContinue(): void {
  if (!canContinue.value) return
  const id = committedId.value
  if (!id) return
  emit('selected', id)
}
</script>

<template>
  <div class="ws-step">
    <div class="brand-hero ws-step__hero">
      <h1 class="brand-title">{{ heroTitle }}</h1>
      <p class="brand-lead">{{ heroLead }}</p>

      <!-- One workspace: stated, not offered. -->
      <div v-if="!showPicker" class="ws-step__list">
        <span
          v-if="soleWorkspace"
          class="ws-row ws-row--static"
          data-testid="devplatform-workspace-static"
        >
          <DevPlatformWorkspaceAvatar :workspace-name="soleWorkspace.name" />
          <span class="ws-row__text">
            <span class="ws-row__name" :title="soleWorkspace.name">{{ soleWorkspace.name }}</span>
            <span class="ws-row__meta">{{ secondaryLabel(soleWorkspace) }}</span>
          </span>
        </span>
      </div>

      <div
        v-else
        ref="listEl"
        class="ws-step__list scroll-visible"
        role="radiogroup"
        :aria-label="$t('devPlatform.workspace.title')"
        @keydown="onWorkspaceKeydown"
      >
        <button
          v-for="(ws, i) in workspaces"
          :key="ws.id"
          type="button"
          class="ws-row"
          role="radio"
          :class="{ 'ws-row--selected': selectedId === ws.id }"
          :aria-checked="selectedId === ws.id"
          :tabindex="rowTabIndex(ws, i)"
          :data-testid="`devplatform-workspace-${ws.id}`"
          @click="selectedId = ws.id"
        >
          <DevPlatformWorkspaceAvatar :workspace-name="ws.name" />
          <span class="ws-row__text">
            <span class="ws-row__name" :title="ws.name">{{ ws.name }}</span>
            <span class="ws-row__meta">{{ secondaryLabel(ws) }}</span>
          </span>
          <!-- The check IS the selection cue; there is no leading radio dot. -->
          <Check v-if="selectedId === ws.id" class="ws-row__check" :size="16" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="ws-step__actions">
      <button
        type="button"
        class="brand-primary"
        data-testid="devplatform-workspace-continue"
        :disabled="!canContinue"
        @click="onContinue"
      >
        {{ $t('devPlatform.workspace.continueCta') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.ws-step {
  display: flex;
  flex-direction: column;
  gap: var(--takeover-gap-md);
  width: 100%;
}

.ws-step__hero {
  display: flex;
  flex-direction: column;
  gap: var(--takeover-gap-sm);
}

/* Row geometry declared once. 448px echoes the reference's max-w-md; 288px
 * max-height caps the list at ~6 rows so Continue stays on screen. */
.ws-step__list {
  --ws-row-padding: 8px 12px;
  --ws-row-radius: 6px;
  --ws-row-gap: 12px;
  --ws-avatar-size: 32px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  max-width: 448px;
  max-height: 288px;
  overflow-y: auto;
  margin-top: var(--takeover-gap-sm);
}

.ws-row {
  display: flex;
  align-items: center;
  gap: var(--ws-row-gap);
  width: 100%;
  padding: var(--ws-row-padding);
  border: none;
  border-radius: var(--ws-row-radius);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.ws-row:hover {
  background: color-mix(in oklab, var(--neutral-100) 6%, transparent);
}

/* Selection: neutral lift, deliberately not yellow — that belongs to the
 * Continue CTA alone. */
.ws-row--selected,
.ws-row--selected:hover {
  background: var(--secondary-background);
}

.ws-row:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.ws-row__text {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
}

.ws-row__name {
  font-size: var(--takeover-fs-body);
  line-height: 1.35;
  color: var(--neutral-100);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-row__meta {
  font-size: var(--takeover-fs-caption);
  line-height: 1.35;
  color: var(--neutral-300);
}

.ws-row__check {
  flex: 0 0 auto;
  color: var(--neutral-100);
}

/* Stated, not offered: same box as `.ws-row`, minus every affordance. */
.ws-row--static {
  cursor: default;
}
.ws-row--static:hover {
  background: transparent;
}

.ws-step__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--takeover-gap-sm);
  margin-top: var(--takeover-gap-sm);
}

@media (prefers-reduced-motion: reduce) {
  .ws-row {
    transition: none;
  }
}
</style>
