<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { Loader2 } from 'lucide-vue-next'
import BaseSelect, { type BaseSelectOption } from '../../components/ui/BaseSelect.vue'
import InfoTooltip from '../../components/InfoTooltip.vue'
import VersionStatPanel, { type VersionStatRow } from './VersionStatPanel.vue'
import { formatRelativeFromMs } from '../../lib/datetime'
import type { ActionDef, DetailField, DetailFieldOption } from '../../types/ipc'
import { TID } from '../../../../shared/testIds'

interface Props {
  field: DetailField
  sectionActions?: ActionDef[]
  /** Inline-action busy set driving the per-button spinner + disabled state. */
  runningActionIds?: Set<string>
}

const props = withDefaults(defineProps<Props>(), {
  sectionActions: () => [],
  runningActionIds: () => new Set<string>()
})

const runningIdsSet = computed(() => props.runningActionIds ?? new Set<string>())
function isActionRunning(actionId: string): boolean {
  return runningIdsSet.value.has(actionId)
}

const emit = defineEmits<{
  action: [action: ActionDef]
}>()

const { t, d } = useI18n()

const state = reactive({
  draft: '' as string
})

watch(
  () => props.field.value,
  (next) => {
    state.draft = String(next ?? '')
  },
  { immediate: true }
)

const currentValue = computed(() => String(props.field.value ?? ''))

// --- Cascading group dropdowns (generic, driven by `groupPath`) ---
// Options sharing a path prefix sit behind one dropdown per level (e.g.
// PyTorch backend series -> version). Every group selection maps to a
// concrete option so preview/actions always describe a real choice.

const groupDepth = computed(() => {
  let depth = 0
  for (const opt of props.field.options ?? []) {
    depth = Math.max(depth, opt.groupPath?.length ?? 0)
  }
  return depth
})

// Cascade only when every option carries a full-depth path; mixed or partial
// paths fall back to the flat picker so no option becomes unreachable.
const cascadeActive = computed(
  () =>
    groupDepth.value > 0 &&
    (props.field.options ?? []).every((o) => (o.groupPath?.length ?? 0) === groupDepth.value)
)

const selectedOption = computed<DetailFieldOption | undefined>(() => {
  const opts = props.field.options ?? []
  const exact = opts.find((o) => o.value === state.draft)
  // In cascade mode an unknown draft (e.g. the value vanished in an options
  // refresh) falls back to the first option so the group dropdowns, concrete
  // dropdown, preview, and actions all describe the same real choice; flat
  // mode keeps exact-match semantics.
  return exact ?? (cascadeActive.value ? opts[0] : undefined)
})

/** The value the concrete dropdown displays: the effective (possibly
 *  fallen-back) selection in cascade mode, the raw draft when flat. */
const concreteValue = computed(() =>
  cascadeActive.value ? (selectedOption.value?.value ?? state.draft) : state.draft
)

const selectedActions = computed<ActionDef[]>(() => {
  const data = selectedOption.value?.data as Record<string, unknown> | undefined
  return (data?.actions as ActionDef[] | undefined) ?? []
})

const draftIsCurrent = computed(() => concreteValue.value === currentValue.value)

interface PreviewData {
  /** What this card updates ("ComfyUI", "PyTorch"); keeps the headline
   *  self-identifying when the Update tab shows several update cards. */
  productName?: string
  installedVersion?: string
  latestVersion?: string
  /** Overrides the "Latest" stat-row label - e.g. the PyTorch card says
   *  "Selected" because the user may have picked a downgrade. */
  latestLabel?: string
  lastChecked?: string
  lastCheckedAt?: number
  updateAvailable?: boolean
  /** Suppress the "Up to date" badge when there is no update. The PyTorch
   *  card sets this: other stacks are still selectable in the picker, so
   *  "Up to date" would wrongly imply nothing is available. */
  hideUpToDateBadge?: boolean
  /** True while `commitsAhead` is still being computed; drives the
   *  "Computing commits ahead…" hint so the label swap isn't a surprise. */
  enriching?: boolean
}

const preview = computed<PreviewData | null>(() => {
  const data = selectedOption.value?.data as PreviewData | undefined
  if (!data) return null
  return {
    productName: data.productName,
    installedVersion: data.installedVersion,
    latestVersion: data.latestVersion,
    latestLabel: data.latestLabel,
    lastChecked: data.lastChecked,
    lastCheckedAt: data.lastCheckedAt,
    updateAvailable: data.updateAvailable,
    hideUpToDateBadge: data.hideUpToDateBadge,
    enriching: data.enriching
  }
})

// Safety net: if the background `commitsAhead` enrichment never completes
// (offline / timeout), hide the hint after 10s so it doesn't hang forever.
const ENRICHING_HINT_MAX_MS = 10_000
const enrichingTimedOut = ref(false)
let enrichingTimer: ReturnType<typeof setTimeout> | null = null

function clearEnrichingTimer(): void {
  if (enrichingTimer !== null) {
    clearTimeout(enrichingTimer)
    enrichingTimer = null
  }
}

watch(
  () => preview.value?.enriching === true,
  (isEnriching) => {
    clearEnrichingTimer()
    if (!isEnriching) {
      enrichingTimedOut.value = false
      return
    }
    enrichingTimedOut.value = false
    enrichingTimer = setTimeout(() => {
      enrichingTimedOut.value = true
      enrichingTimer = null
    }, ENRICHING_HINT_MAX_MS)
  },
  { immediate: true }
)

onBeforeUnmount(clearEnrichingTimer)

const showEnrichingHint = computed(
  () => preview.value?.enriching === true && !enrichingTimedOut.value
)

function formatVersionLabel(raw: string | undefined): string {
  if (!raw || raw === '—') return '—'
  const trimmed = raw.trim()
  if (trimmed.startsWith('v') || trimmed.startsWith('V')) return trimmed
  return `v${trimmed}`
}

function normalizeVersion(raw: string | undefined): string {
  if (!raw || raw === '—') return ''
  return raw.trim().replace(/^[vV]/, '').toLowerCase()
}

const versionsMatch = computed(() => {
  if (!preview.value) return false
  const installed = normalizeVersion(preview.value.installedVersion)
  const latest = normalizeVersion(preview.value.latestVersion)
  if (!installed || !latest) return false
  return installed === latest
})

/** Product prefix ("ComfyUI", "PyTorch") so multiple update cards on the
 *  same tab each say what they update. */
const headlineProduct = computed(() => preview.value?.productName ?? '')

const headlineVersion = computed(() => {
  if (!preview.value) {
    return draftIsCurrent.value
      ? t('channelCards.upToDate', 'Up to date')
      : t('channelCards.switchTo', { channel: selectedOption.value?.label ?? '' })
  }
  if (preview.value.updateAvailable) {
    const ver = preview.value.latestVersion
    return ver && ver !== '—'
      ? formatVersionLabel(ver)
      : t('channelCards.updateAvailable', 'Update available')
  }
  return formatVersionLabel(preview.value.installedVersion)
})

const statusBadge = computed(() => {
  if (!preview.value) return null
  if (preview.value.updateAvailable) {
    return t('channelCards.updateAvailable', 'Update available')
  }
  if (preview.value.hideUpToDateBadge) return null
  return t('channelCards.upToDate', 'Up to date')
})

const statusBadgeTone = computed<'current' | 'update'>(() =>
  preview.value?.updateAvailable ? 'update' : 'current'
)

type StatRow = VersionStatRow

const lastCheckedDisplay = computed<{ value: string; title?: string } | null>(() => {
  if (!preview.value) return null
  if (preview.value.lastCheckedAt) {
    const ms = preview.value.lastCheckedAt
    let title: string | undefined
    try {
      title = d(new Date(ms), 'long')
    } catch {
      title = new Date(ms).toLocaleString()
    }
    return { value: formatRelativeFromMs(ms, t), title }
  }
  if (preview.value.lastChecked && preview.value.lastChecked !== '—') {
    return { value: preview.value.lastChecked }
  }
  return null
})

const statRows = computed<StatRow[]>(() => {
  if (!preview.value) return []
  const rows: StatRow[] = []
  const updateAvailable = preview.value.updateAvailable === true

  if (updateAvailable && preview.value.installedVersion) {
    rows.push({
      id: 'installed',
      label: t('channelCards.installedVersion', 'Installed'),
      value: formatVersionLabel(preview.value.installedVersion)
    })
  }
  if (updateAvailable && preview.value.latestVersion && !versionsMatch.value) {
    rows.push({
      id: 'latest',
      label: preview.value.latestLabel ?? t('channelCards.latestVersion', 'Latest'),
      value: formatVersionLabel(preview.value.latestVersion),
      highlight: true
    })
  }

  const lastChecked = lastCheckedDisplay.value
  if (lastChecked) {
    rows.push({
      id: 'last-checked',
      label: t('channelCards.lastChecked', 'Last checked'),
      value: lastChecked.value,
      title: lastChecked.title
    })
  }

  return rows
})

const allActions = computed<ActionDef[]>(() => [...selectedActions.value, ...props.sectionActions])

const checkUpdateAction = computed<ActionDef | undefined>(() =>
  allActions.value.find((a) => a.id === 'check-update')
)

const promotedPrimaryActions = computed<ActionDef[]>(() =>
  selectedActions.value.filter(
    (a) =>
      a.id === 'update-comfyui' ||
      a.id === 'copy-update' ||
      a.id === 'change-pytorch' ||
      a.id === 'copy-pytorch'
  )
)

const otherSecondaryActions = computed<ActionDef[]>(() =>
  selectedActions.value.filter(
    (a) =>
      a.id !== 'check-update' &&
      a.id !== 'update-comfyui' &&
      a.id !== 'copy-update' &&
      a.id !== 'copy-pytorch' &&
      a.style !== 'primary' &&
      a.style !== 'accent'
  )
)

const showCheckInHeader = computed(
  () =>
    checkUpdateAction.value != null &&
    promotedPrimaryActions.value.length === 0 &&
    otherSecondaryActions.value.length === 0
)

// Only surface the manual check when no update is already visible.
const showCheckUpdateInFooter = computed(
  () =>
    checkUpdateAction.value != null &&
    !showCheckInHeader.value &&
    preview.value?.updateAvailable !== true
)

const showFooterActions = computed(
  () =>
    promotedPrimaryActions.value.length > 0 ||
    otherSecondaryActions.value.length > 0 ||
    showCheckUpdateInFooter.value
)

const footerActions = computed<
  Array<{ action: ActionDef; variant: 'accent' | 'default' | 'danger' }>
>(() => {
  const out: Array<{ action: ActionDef; variant: 'accent' | 'default' | 'danger' }> = []

  if (checkUpdateAction.value && showCheckUpdateInFooter.value) {
    out.push({ action: checkUpdateAction.value, variant: 'default' })
  }

  for (const action of otherSecondaryActions.value) {
    // Switch Channel is the primary intent after picking a channel, so accent it.
    const variant =
      action.id === 'switch-channel' ? 'accent' : action.style === 'danger' ? 'danger' : 'default'
    out.push({ action, variant })
  }

  for (const action of promotedPrimaryActions.value) {
    if (action.id === 'copy-update') {
      out.push({ action, variant: 'default' })
    }
  }

  const updateNow = promotedPrimaryActions.value.find((a) => a.id === 'update-comfyui')
  if (updateNow) {
    out.push({ action: updateNow, variant: 'accent' })
  }

  // Copy & Change PyTorch is the safe alternative, so it sits before the
  // accented Change button, mirroring Copy & Update vs Update Now.
  const copyPytorch = promotedPrimaryActions.value.find((a) => a.id === 'copy-pytorch')
  if (copyPytorch) {
    out.push({ action: copyPytorch, variant: 'default' })
  }

  // The PyTorch card's per-option switch action; accented for the same
  // reason as Update Now (it is the primary intent after picking a stack).
  const changePytorch = promotedPrimaryActions.value.find((a) => a.id === 'change-pytorch')
  if (changePytorch) {
    out.push({ action: changePytorch, variant: 'accent' })
  }

  return out
})

function optionLabel(opt: DetailFieldOption): string {
  if (opt.value === currentValue.value) {
    return `${opt.label} — ${t('channelCards.current', 'Current')}`
  }
  if (opt.recommended) {
    return `${opt.label} — ${t('newInstall.recommended', 'Recommended')}`
  }
  return opt.label
}

function toSelectOption(opt: DetailFieldOption): BaseSelectOption {
  return { value: opt.value, label: optionLabel(opt), description: opt.description }
}

/** Group-id path of the selected option; anchors every level dropdown.
 *  `selectedOption` already falls back to the first option in cascade mode,
 *  so a transiently unknown draft can't blank the cascade. */
const selectedPath = computed<string[]>(() => {
  if (!cascadeActive.value) return []
  return (selectedOption.value?.groupPath ?? []).map((g) => g.id)
})

interface CascadeLevel {
  label?: string
  selected: string
  options: BaseSelectOption[]
}

const cascadeLevels = computed<CascadeLevel[]>(() => {
  if (!cascadeActive.value) return []
  const opts = props.field.options ?? []
  const path = selectedPath.value
  const levels: CascadeLevel[] = []
  for (let level = 0; level < groupDepth.value; level++) {
    const prefix = path.slice(0, level)
    const groups = new Map<string, { label: string; description?: string }>()
    for (const opt of opts) {
      const gp = opt.groupPath ?? []
      const entry = gp[level]
      if (!entry) continue
      if (prefix.every((id, i) => gp[i]?.id === id) && !groups.has(entry.id)) {
        groups.set(entry.id, { label: entry.label, description: entry.description })
      }
    }
    levels.push({
      label: props.field.groupLabels?.[level],
      selected: path[level] ?? '',
      options: [...groups].map(([value, g]) => ({
        value,
        label: g.label,
        description: g.description
      }))
    })
  }
  return levels
})

/** Selecting a group jumps to the first (newest - main emits newest-first)
 *  concrete option under the new prefix, keeping preview/actions real. */
function selectCascadeGroup(level: number, groupId: string): void {
  const prefix = [...selectedPath.value.slice(0, level), groupId]
  const match = (props.field.options ?? []).find((opt) =>
    prefix.every((id, i) => opt.groupPath?.[i]?.id === id)
  )
  if (match) state.draft = match.value
}

/** Options for the final (concrete) dropdown: the whole list when flat, only
 *  the selected group's options when cascading. */
const selectOptions = computed<BaseSelectOption[]>(() => {
  const opts = props.field.options ?? []
  if (!cascadeActive.value) return opts.map(toSelectOption)
  const path = selectedPath.value
  return opts
    .filter((opt) => path.every((id, i) => opt.groupPath?.[i]?.id === id))
    .map(toSelectOption)
})

function actionClass(
  variant: 'default' | 'accent' | 'danger',
  running: boolean,
  compact = false
): string[] {
  return [
    'static inline-flex flex-none items-center justify-center gap-1.5 rounded-lg border border-solid bg-[var(--brand-surface-bg)] whitespace-nowrap box-border appearance-auto transition-[background-color,filter] duration-100 ease-[ease] hover:bg-[var(--brand-surface-bg)] enabled:hover:bg-[var(--brand-surface-bg-hover)] enabled:focus-visible:bg-[var(--brand-surface-bg-hover)] enabled:focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-auto disabled:opacity-50 disabled:cursor-not-allowed',
    compact
      ? 'h-7 min-h-7 px-3 py-0 text-[12px] leading-none'
      : 'h-8 min-h-8 px-4 py-0 text-[13px] leading-none',
    variant === 'accent'
      ? 'border-[var(--accent)] text-[var(--accent)] font-semibold disabled:hover:bg-[var(--accent)] enabled:hover:bg-[var(--accent)] enabled:hover:text-[var(--bg)] enabled:focus-visible:bg-[var(--accent)] enabled:focus-visible:text-[var(--bg)]'
      : variant === 'danger'
        ? 'border-[var(--chooser-surface-border)] text-danger font-medium disabled:hover:bg-[var(--danger)]'
        : 'border-[var(--chooser-surface-border)] text-neutral-100 font-medium',
    running ? 'is-running cursor-progress opacity-85' : 'cursor-pointer'
  ]
}
</script>

<template>
  <div class="channel-picker flex flex-col gap-3">
    <VersionStatPanel
      :headline-product="headlineProduct"
      :headline="headlineVersion"
      :headline-highlight="preview?.updateAvailable === true"
      :badge="preview ? statusBadge : null"
      :badge-tone="statusBadgeTone"
      :rows="statRows"
    />

    <!-- Hint shown while `commitsAhead` is still being computed; self-hides
         after the max window if enrichment never completes. -->
    <p
      v-if="showEnrichingHint"
      class="channel-picker-enriching m-0 inline-flex items-center gap-1.5 text-[12px] leading-4 text-text-muted italic"
      role="status"
      aria-live="polite"
    >
      <Loader2
        :size="12"
        class="channel-picker-enriching-spinner flex-none animate-spin [animation-duration:0.9s] motion-reduce:animate-none"
        aria-hidden="true"
      />
      {{ t('channelCards.computingCommitsAhead', 'Computing commits ahead…') }}
    </p>

    <div
      class="channel-picker-card flex flex-col gap-3 rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)] p-3"
    >
      <div class="channel-picker-channel-header flex items-center justify-between gap-3">
        <span
          class="channel-picker-field-label inline-flex items-center gap-0.5 text-[12px] leading-4 font-normal text-text-muted"
        >
          {{ field.label }}
          <InfoTooltip v-if="field.tooltip" :text="field.tooltip" />
        </span>
        <Button
          v-if="showCheckInHeader && checkUpdateAction"
          variant="textonly"
          size="unset"
          type="button"
          class="channel-picker-action compact"
          :class="actionClass('default', isActionRunning(checkUpdateAction.id), true)"
          :disabled="checkUpdateAction.enabled === false || isActionRunning(checkUpdateAction.id)"
          :title="checkUpdateAction.tooltip"
          :data-testid="TID.updateActionButton(checkUpdateAction.id)"
          @click="emit('action', checkUpdateAction)"
        >
          <Loader2
            v-if="isActionRunning(checkUpdateAction.id)"
            :size="14"
            class="channel-picker-action-spinner flex-none animate-spin [animation-duration:0.9s]"
          />
          {{ checkUpdateAction.label }}
        </Button>
      </div>

      <div class="channel-picker-channel flex flex-col gap-2">
        <div
          v-for="(level, i) in cascadeLevels"
          :key="i"
          class="channel-picker-cascade-level flex flex-col gap-1"
          :data-testid="TID.channelGroupSelect(i)"
        >
          <span
            v-if="level.label"
            class="channel-picker-field-label inline-flex items-center gap-0.5 text-[12px] leading-4 font-normal text-text-muted"
            >{{ level.label }}</span
          >
          <BaseSelect
            :model-value="level.selected"
            :options="level.options"
            :aria-label="level.label ?? field.label"
            @update:model-value="selectCascadeGroup(i, $event)"
          />
        </div>
        <BaseSelect
          :model-value="concreteValue"
          :options="selectOptions"
          :aria-label="field.label"
          @update:model-value="state.draft = $event"
        />
        <p
          v-if="selectedOption?.description"
          class="channel-picker-desc m-0 text-[12px] leading-[16.5px] text-text-muted"
        >
          {{ selectedOption.description }}
        </p>
      </div>

      <p
        v-if="!draftIsCurrent && !preview"
        class="channel-picker-empty m-0 rounded-md border border-dashed border-[var(--chooser-surface-border)] px-2.5 py-2 text-[12px] leading-4 text-text-muted"
      >
        {{ t('channelCards.noInfo', 'No information available for this channel.') }}
      </p>
      <p
        v-else-if="!draftIsCurrent && preview"
        class="channel-picker-switch-hint m-0 text-[12px] leading-4 text-text-muted"
      >
        {{ t('channelCards.switchTo', { channel: selectedOption?.label ?? '' }) }}
      </p>

      <div
        v-if="showFooterActions"
        class="channel-picker-actions mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-solid border-border-hover pt-3"
      >
        <Button
          v-for="{ action, variant } in footerActions"
          :key="action.id"
          variant="textonly"
          size="unset"
          type="button"
          class="channel-picker-action"
          :class="actionClass(variant, isActionRunning(action.id))"
          :data-variant="variant"
          :disabled="action.enabled === false || isActionRunning(action.id)"
          :title="action.tooltip"
          :data-testid="TID.updateActionButton(action.id)"
          @click="emit('action', action)"
        >
          <Loader2
            v-if="isActionRunning(action.id)"
            :size="14"
            class="channel-picker-action-spinner flex-none animate-spin [animation-duration:0.9s]"
          />
          {{ action.label }}
        </Button>
      </div>
    </div>
  </div>
</template>
