<script setup lang="ts">
/**
 * PROTOTYPE (throwaway branch) — the distribution Details / Manage surface.
 *
 * Presented the same way as the install Manage view (identity header, left
 * tab rail, tabbed body) but renderer-local against the mock distributions:
 * the real picker popup is main-process-fed and can't host mock data. When
 * the backend link lands this ports into `ComfyUISettingsContent`.
 *
 * Two modes:
 *   - details: uninstalled distribution — read-only spec sheet (Overview
 *     only), Install CTA when installable.
 *   - manage:  installed distribution — Overview + Update tabs; the Update
 *     pane is distribution-relevant (Dist versions, not ComfyUI) and can
 *     fire the update just like the card pill.
 *
 * Prototype copy is hardcoded English — dies with the branch.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, Info, Package, X } from 'lucide-vue-next'
import type { Distribution, DistributionState } from '../../devplatform/types'

const props = defineProps<{
  distribution: Distribution
  mode: 'details' | 'manage'
  /** Shown as the owning workspace on the Overview pane. */
  workspaceName: string
}>()

const emit = defineEmits<{
  close: []
  /** Install (details mode) or update (manage mode) — the same action the
   *  card itself performs. */
  install: []
}>()

const { t } = useI18n()

const dist = computed(() => props.distribution)

type TabId = 'overview' | 'update'
const activeTab = ref<TabId>('overview')

const hasUpdate = computed(() => dist.value.state === 'update-available')

const tabs = computed<{ id: TabId; label: string; icon: typeof Info; badge: boolean }[]>(() => {
  const list = [{ id: 'overview' as TabId, label: 'Overview', icon: Info, badge: false }]
  if (props.mode === 'manage') {
    list.push({ id: 'update', label: 'Update', icon: ArrowDownToLine, badge: hasUpdate.value })
  }
  return list
})

const BLOCKED_STATES: readonly DistributionState[] = [
  'no-build',
  'platform-mismatch',
  'needs-desktop-update'
]
const BLOCKED_STATE_KEY: Record<string, string> = {
  'no-build': 'noBuild',
  'platform-mismatch': 'platformMismatch',
  'needs-desktop-update': 'needsDesktopUpdate'
}

const isBlocked = computed(() => BLOCKED_STATES.includes(dist.value.state))

/** Full blocked explanation — same i18n contract as the card. */
const blockedReason = computed(() => {
  if (!isBlocked.value) return ''
  const suffix = dist.value.blockedReason ?? BLOCKED_STATE_KEY[dist.value.state] ?? 'noBuild'
  return t(`devPlatform.distribution.blockedReason.${suffix}`, {
    version: dist.value.minDesktopVersion ?? ''
  })
})

const headerMeta = computed(() =>
  [
    dist.value.comfyuiVersion ? `v${dist.value.comfyuiVersion}` : '',
    dist.value.version ? `Dist v${dist.value.version}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
)

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

function formatDate(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Overview facts — rendered top to bottom; empty values drop their row. */
const overviewRows = computed<{ label: string; value: string }[]>(() =>
  [
    { label: 'Workspace', value: props.workspaceName },
    {
      label: 'Installed version',
      value:
        props.mode === 'manage' && dist.value.installedVersion
          ? `Dist v${dist.value.installedVersion}`
          : ''
    },
    { label: 'Latest version', value: dist.value.version ? `Dist v${dist.value.version}` : '' },
    {
      label: 'ComfyUI version',
      value: dist.value.comfyuiVersion ? `v${dist.value.comfyuiVersion}` : ''
    },
    { label: 'Download size', value: formatSize(dist.value.sizeBytes) },
    { label: 'Published', value: formatDate(dist.value.finishedAt) }
  ].filter((row) => row.value)
)

/** Details-mode footer CTA: install, only when actually installable. */
const showInstallCta = computed(
  () => props.mode === 'details' && dist.value.state === 'installable'
)

function handlePrimary(): void {
  emit('install')
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="dist-overlay-backdrop" @click.self="emit('close')">
    <div class="dist-overlay" role="dialog" aria-modal="true" :aria-label="dist.name">
      <button
        type="button"
        class="dist-overlay-close"
        aria-label="Close"
        @click="emit('close')"
      >
        <X :size="16" />
      </button>

      <!-- Left rail — same shape as the Manage view's tab rail; details mode
           simply has fewer tabs. -->
      <aside class="dist-overlay-rail">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="dist-overlay-tab"
          :class="{ 'dist-overlay-tab--active': activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" :size="14" aria-hidden="true" />
          <span class="dist-overlay-tab-label">{{ tab.label }}</span>
          <span v-if="tab.badge" class="dist-overlay-tab-badge" aria-hidden="true" />
        </button>
      </aside>

      <section class="dist-overlay-body">
        <header class="dist-overlay-head">
          <span class="dist-overlay-icon"><Package :size="28" /></span>
          <div class="dist-overlay-title">
            <h2 class="dist-overlay-name">{{ dist.name }}</h2>
            <p v-if="headerMeta" class="dist-overlay-meta">{{ headerMeta }}</p>
          </div>
        </header>

        <!-- Overview: read-only spec sheet. -->
        <div v-if="activeTab === 'overview'" class="dist-overlay-pane">
          <p v-if="dist.description" class="dist-overlay-desc">{{ dist.description }}</p>

          <div v-if="blockedReason" class="dist-overlay-blocked" role="note">
            {{ blockedReason }}
          </div>

          <dl class="dist-overlay-facts">
            <template v-for="row in overviewRows" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </template>
          </dl>
        </div>

        <!-- Update: distribution-relevant update pane (manage mode). -->
        <div v-else class="dist-overlay-pane">
          <template v-if="hasUpdate">
            <h3 class="dist-overlay-update-headline">Dist v{{ dist.version }} is available</h3>
            <p class="dist-overlay-update-sub">
              You have Dist v{{ dist.installedVersion ?? '?' }}. Updates are published by
              {{ props.workspaceName }}.
            </p>
            <p v-if="formatDate(dist.finishedAt) || formatSize(dist.sizeBytes)" class="dist-overlay-update-facts">
              {{ [formatDate(dist.finishedAt), formatSize(dist.sizeBytes)].filter(Boolean).join(' · ') }}
            </p>
            <button type="button" class="dist-overlay-cta" @click="handlePrimary">
              <ArrowDownToLine :size="14" aria-hidden="true" />
              Update to Dist v{{ dist.version }}
            </button>
          </template>
          <template v-else>
            <h3 class="dist-overlay-update-headline">You're up to date</h3>
            <p class="dist-overlay-update-sub">
              Dist v{{ dist.installedVersion ?? dist.version }} is the latest version published by
              {{ props.workspaceName }}.
            </p>
          </template>
        </div>

        <footer v-if="showInstallCta" class="dist-overlay-foot">
          <button type="button" class="dist-overlay-cta" @click="handlePrimary">
            <ArrowDownToLine :size="14" aria-hidden="true" />
            {{ t('devPlatform.distribution.menuInstall') }}
          </button>
        </footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.dist-overlay-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}

.dist-overlay {
  position: relative;
  display: flex;
  width: min(640px, calc(100vw - 48px));
  min-height: 340px;
  max-height: min(520px, calc(100vh - 48px));
  border-radius: 14px;
  border: 1px solid var(--modal-surface-border, rgba(255, 255, 255, 0.08));
  background: var(--modal-surface-bg, #17171c);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.dist-overlay-close {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background-color 100ms ease,
    color 100ms ease;
}
.dist-overlay-close:hover,
.dist-overlay-close:focus-visible {
  background: var(--bg-elev-2, rgba(127, 127, 127, 0.18));
  color: var(--text);
  outline: none;
}

/* --- Tab rail --- */

.dist-overlay-rail {
  flex: 0 0 148px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 8px;
  border-right: 1px solid var(--chooser-surface-border);
}

.dist-overlay-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background-color 100ms ease,
    color 100ms ease;
}
.dist-overlay-tab:hover {
  background: var(--chooser-surface-bg-hover);
  color: var(--text);
}
.dist-overlay-tab--active {
  background: var(--chooser-surface-bg-hover);
  color: var(--text);
}
.dist-overlay-tab-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dist-overlay-tab-badge {
  margin-left: auto;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--accent, #4a90e2);
  flex-shrink: 0;
}

/* --- Body --- */

.dist-overlay-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 18px 20px 16px;
  overflow-y: auto;
}

.dist-overlay-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-right: 32px;
  margin-bottom: 14px;
}
.dist-overlay-icon {
  color: var(--neutral-100);
  opacity: 0.85;
  flex-shrink: 0;
}
.dist-overlay-title {
  min-width: 0;
}
.dist-overlay-name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dist-overlay-meta {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-faint);
}

.dist-overlay-pane {
  flex: 1 1 auto;
  min-height: 0;
}

.dist-overlay-desc {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}

.dist-overlay-blocked {
  margin: 0 0 14px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--chooser-surface-border-hover);
  background: var(--chooser-surface-bg);
  font-size: 12px;
  line-height: 1.45;
  color: var(--neutral-200);
}

.dist-overlay-facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 7px 18px;
  margin: 0;
  font-size: 12px;
}
.dist-overlay-facts dt {
  color: var(--text-faint);
}
.dist-overlay-facts dd {
  margin: 0;
  color: var(--text);
  font-weight: 500;
}

/* --- Update pane --- */

.dist-overlay-update-headline {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.dist-overlay-update-sub {
  margin: 0 0 4px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-muted);
}
.dist-overlay-update-facts {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--text-faint);
}

/* --- CTA + footer --- */

.dist-overlay-foot {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

.dist-overlay-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--accent, #4a90e2);
  background: var(--accent-soft, rgba(74, 144, 226, 0.12));
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--accent, #4a90e2);
  cursor: pointer;
  transition:
    background-color 120ms ease,
    transform 120ms ease;
}
.dist-overlay-cta:hover,
.dist-overlay-cta:focus-visible {
  background: var(--accent-soft-hover, rgba(74, 144, 226, 0.22));
  outline: none;
}
</style>
