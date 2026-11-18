<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import Checkbox from '@comfyorg/design-system/checkbox/Checkbox'
import { ArrowUpCircle, CircleCheck, Loader2 } from '@lucide/vue'
import BaseSelect, { type BaseSelectOption } from '../../components/ui/BaseSelect.vue'
import InfoTooltip from '../../components/InfoTooltip.vue'
import type { VersionStatRow } from './VersionStatPanel.vue'
import { formatRelativeFromMs } from '../../lib/datetime'
import type { ActionDef, DetailField, DetailFieldOption } from '../../types/ipc'
import { TID } from '../../../../shared/testIds'

interface Props {
  field: DetailField
  sectionActions?: ActionDef[]
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
  'update-field': [field: DetailField, value: boolean]
}>()

const footerToggle = computed(() => props.field.footerToggle ?? null)

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

const groupDepth = computed(() => {
  let depth = 0
  for (const opt of props.field.options ?? []) {
    depth = Math.max(depth, opt.groupPath?.length ?? 0)
  }
  return depth
})

const cascadeActive = computed(
  () =>
    groupDepth.value > 0 &&
    (props.field.options ?? []).every((o) => (o.groupPath?.length ?? 0) === groupDepth.value)
)

const selectedOption = computed<DetailFieldOption | undefined>(() => {
  const opts = props.field.options ?? []
  const exact = opts.find((o) => o.value === state.draft)
  return exact ?? (cascadeActive.value ? opts[0] : undefined)
})

const concreteValue = computed(() =>
  cascadeActive.value ? (selectedOption.value?.value ?? state.draft) : state.draft
)

function actionsOf(option: DetailFieldOption | undefined): ActionDef[] {
  const data = option?.data as Record<string, unknown> | undefined
  return (data?.actions as ActionDef[] | undefined) ?? []
}

const selectedActions = computed<ActionDef[]>(() => actionsOf(selectedOption.value))

const draftIsCurrent = computed(() => concreteValue.value === currentValue.value)

interface PreviewData {
  productName?: string
  installedVersion?: string
  latestVersion?: string
  latestLabel?: string
  lastChecked?: string
  lastCheckedAt?: number
  updateAvailable?: boolean
  hideUpToDateBadge?: boolean
  enriching?: boolean
}

function previewOf(option: DetailFieldOption | undefined): PreviewData | null {
  const data = option?.data as PreviewData | undefined
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
}

const preview = computed<PreviewData | null>(() => previewOf(selectedOption.value))

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

function versionsMatch(optionPreview: PreviewData): boolean {
  const installed = normalizeVersion(optionPreview.installedVersion)
  const latest = normalizeVersion(optionPreview.latestVersion)
  if (!installed || !latest) return false
  return installed === latest
}

function headlineVersionOf(
  option: DetailFieldOption | undefined,
  optionPreview: PreviewData | null,
  isCurrent: boolean
): string {
  if (!optionPreview) {
    return isCurrent
      ? t('channelCards.upToDate')
      : t('channelCards.switchTo', { channel: option?.label ?? '' })
  }
  if (optionPreview.updateAvailable) {
    const ver = optionPreview.latestVersion
    return ver && ver !== '—' ? formatVersionLabel(ver) : t('channelCards.updateAvailable')
  }
  return formatVersionLabel(optionPreview.installedVersion)
}

function statusBadgeOf(optionPreview: PreviewData | null): string | null {
  if (!optionPreview) return null
  if (optionPreview.updateAvailable) {
    return t('channelCards.updateAvailable')
  }
  if (optionPreview.hideUpToDateBadge) return null
  return t('channelCards.upToDate')
}

type StatRow = VersionStatRow

function lastCheckedOf(
  optionPreview: PreviewData | null
): { value: string; title?: string } | null {
  if (!optionPreview) return null
  if (optionPreview.lastCheckedAt) {
    const ms = optionPreview.lastCheckedAt
    let title: string | undefined
    try {
      title = d(new Date(ms), 'long')
    } catch {
      title = new Date(ms).toLocaleString()
    }
    return { value: formatRelativeFromMs(ms, t), title }
  }
  if (optionPreview.lastChecked && optionPreview.lastChecked !== '—') {
    return { value: optionPreview.lastChecked }
  }
  return null
}

function statRowsOf(
  optionPreview: PreviewData | null,
  lastChecked: { value: string; title?: string } | null
): StatRow[] {
  if (!optionPreview) return []
  const rows: StatRow[] = []
  const updateAvailable = optionPreview.updateAvailable === true

  if (updateAvailable && optionPreview.installedVersion) {
    rows.push({
      id: 'installed',
      label: t('channelCards.installedVersion'),
      value: formatVersionLabel(optionPreview.installedVersion)
    })
  }
  if (updateAvailable && optionPreview.latestVersion && !versionsMatch(optionPreview)) {
    rows.push({
      id: 'latest',
      label: optionPreview.latestLabel ?? t('channelCards.latestVersion'),
      value: formatVersionLabel(optionPreview.latestVersion),
      highlight: true
    })
  }

  if (lastChecked) {
    rows.push({
      id: 'last-checked',
      label: t('channelCards.lastChecked'),
      value: lastChecked.value,
      title: lastChecked.title
    })
  }

  return rows
}

function isPromotedPrimary(action: ActionDef): boolean {
  return (
    action.id === 'update-comfyui' ||
    action.id === 'copy-update' ||
    action.id === 'change-pytorch' ||
    action.id === 'copy-pytorch'
  )
}

function isOtherSecondary(action: ActionDef): boolean {
  return (
    action.id !== 'check-update' &&
    action.id !== 'update-comfyui' &&
    action.id !== 'copy-update' &&
    action.id !== 'copy-pytorch' &&
    action.style !== 'primary' &&
    action.style !== 'accent'
  )
}

function checkUpdateActionOf(option: DetailFieldOption | undefined): ActionDef | undefined {
  return [...actionsOf(option), ...props.sectionActions].find((a) => a.id === 'check-update')
}

function headerCheckActionOf(option: DetailFieldOption | undefined): ActionDef | undefined {
  const actions = actionsOf(option)
  if (actions.some(isPromotedPrimary) || actions.some(isOtherSecondary)) return undefined
  return checkUpdateActionOf(option)
}

interface OptionStatus {
  selected: boolean
  product: string
  version: string
  updateAvailable: boolean
  badge: string | null
  line: string
  lastCheckedTitle: string | undefined
  headerCheckAction: ActionDef | undefined
}

function statusOf(option: DetailFieldOption | undefined, selected: boolean): OptionStatus {
  const optionPreview = previewOf(option)
  const isCurrent = option ? option.value === currentValue.value : draftIsCurrent.value
  const badge = statusBadgeOf(optionPreview)
  const lastChecked = lastCheckedOf(optionPreview)
  return {
    selected,
    product: optionPreview?.productName ?? '',
    version: headlineVersionOf(option, optionPreview, isCurrent),
    updateAvailable: optionPreview?.updateAvailable === true,
    badge,
    line: [
      badge,
      ...statRowsOf(optionPreview, lastChecked).map((row) => `${row.label} ${row.value}`)
    ]
      .filter(Boolean)
      .join('  ·  '),
    lastCheckedTitle: lastChecked?.title,
    headerCheckAction: headerCheckActionOf(option)
  }
}

const selectedFirstThenEveryOtherOption = computed<OptionStatus[]>(() => {
  const selected = selectedOption.value
  const others = (props.field.options ?? []).filter((option) => option !== selected)
  return [statusOf(selected, true), ...others.map((option) => statusOf(option, false))]
})

const checkUpdateAction = computed<ActionDef | undefined>(() =>
  checkUpdateActionOf(selectedOption.value)
)

const promotedPrimaryActions = computed<ActionDef[]>(() =>
  selectedActions.value.filter(isPromotedPrimary)
)

const otherSecondaryActions = computed<ActionDef[]>(() =>
  selectedActions.value.filter(isOtherSecondary)
)

const showCheckInHeader = computed(() => headerCheckActionOf(selectedOption.value) != null)

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
    showCheckUpdateInFooter.value ||
    footerToggle.value != null
)

const footerActions = computed<
  Array<{ action: ActionDef; variant: 'accent' | 'default' | 'danger' }>
>(() => {
  const out: Array<{ action: ActionDef; variant: 'accent' | 'default' | 'danger' }> = []

  if (checkUpdateAction.value && showCheckUpdateInFooter.value) {
    out.push({ action: checkUpdateAction.value, variant: 'default' })
  }

  for (const action of otherSecondaryActions.value) {
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

  const copyPytorch = promotedPrimaryActions.value.find((a) => a.id === 'copy-pytorch')
  if (copyPytorch) {
    out.push({ action: copyPytorch, variant: 'default' })
  }

  const changePytorch = promotedPrimaryActions.value.find((a) => a.id === 'change-pytorch')
  if (changePytorch) {
    out.push({ action: changePytorch, variant: 'accent' })
  }

  return out
})

function optionLabel(opt: DetailFieldOption): string {
  if (opt.value === currentValue.value) {
    return `${opt.label} — ${t('channelCards.current')}`
  }
  if (opt.recommended) {
    return `${opt.label} — ${t('newInstall.recommended')}`
  }
  return opt.label
}

function toSelectOption(opt: DetailFieldOption): BaseSelectOption {
  return { value: opt.value, label: optionLabel(opt), description: opt.description }
}

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

function selectCascadeGroup(level: number, groupId: string): void {
  const prefix = [...selectedPath.value.slice(0, level), groupId]
  const match = (props.field.options ?? []).find((opt) =>
    prefix.every((id, i) => opt.groupPath?.[i]?.id === id)
  )
  if (match) state.draft = match.value
}

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
      ? 'border-[var(--action)] text-[var(--action)] font-semibold disabled:hover:bg-[var(--action)] enabled:hover:bg-[var(--action)] enabled:hover:text-[var(--bg)] enabled:focus-visible:bg-[var(--action)] enabled:focus-visible:text-[var(--bg)]'
      : variant === 'danger'
        ? 'border-[var(--chooser-surface-border)] text-danger font-medium disabled:hover:bg-[var(--danger)]'
        : 'border-[var(--chooser-surface-border)] text-neutral-100 font-medium',
    running ? 'is-running cursor-progress opacity-85' : 'cursor-pointer'
  ]
}
</script>

<template>
  <div class="channel-picker flex flex-col gap-3">
    <div
      class="channel-picker-status-stack grid grid-cols-1 rounded-xl border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)]"
    >
      <div
        v-for="(status, index) in selectedFirstThenEveryOtherOption"
        :key="index"
        class="col-start-1 row-start-1 flex min-w-0 items-center gap-3 p-3.5"
        :class="
          status.selected ? 'channel-picker-status' : 'channel-picker-status-reserve invisible'
        "
        :data-testid="status.selected ? 'channel-picker-status' : undefined"
        :aria-hidden="status.selected ? undefined : true"
        :inert="!status.selected"
      >
        <span
          v-if="status.badge"
          class="channel-picker-status-icon grid size-8 flex-none place-items-center rounded-full"
          :class="
            status.updateAvailable
              ? 'bg-[color-mix(in_srgb,var(--action)_14%,transparent)] text-[var(--action)]'
              : 'bg-[color-mix(in_srgb,var(--success,#4ade80)_14%,transparent)] text-[var(--success,#4ade80)]'
          "
          aria-hidden="true"
        >
          <ArrowUpCircle v-if="status.updateAvailable" :size="18" />
          <CircleCheck v-else :size="18" />
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex min-w-0 items-baseline">
            <p
              class="m-0 flex min-w-0 flex-wrap items-baseline gap-1.5 text-[14px] leading-5 font-medium text-text"
            >
              <span v-if="status.product" class="channel-picker-headline-product">{{
                status.product
              }}</span>
              <span
                class="channel-picker-headline-version"
                :class="{ 'is-update-available text-[var(--action)]': status.updateAvailable }"
                >{{ status.version }}</span
              >
            </p>
            <p
              v-if="status.selected && showEnrichingHint"
              class="channel-picker-enriching m-0 min-w-0 flex-1 basis-0 overflow-hidden"
              role="status"
              aria-live="polite"
            >
              <span class="block truncate pl-2.5 text-[12px] leading-4 text-text-muted italic">
                <Loader2
                  :size="12"
                  class="channel-picker-enriching-spinner mr-1.5 inline-block animate-spin align-[-0.125em] [animation-duration:0.9s] motion-reduce:animate-none"
                  aria-hidden="true"
                />{{ t('channelCards.computingCommitsAhead') }}
              </span>
            </p>
          </div>
          <p
            v-if="status.line"
            class="channel-picker-status-line m-0 text-[12px] leading-4 text-text-muted"
            :title="status.lastCheckedTitle"
          >
            {{ status.line }}
          </p>
        </div>
        <Button
          v-if="status.headerCheckAction"
          variant="textonly"
          size="unset"
          type="button"
          class="channel-picker-action compact"
          :class="actionClass('default', isActionRunning(status.headerCheckAction.id), true)"
          :disabled="
            status.headerCheckAction.enabled === false ||
            isActionRunning(status.headerCheckAction.id)
          "
          :title="status.headerCheckAction.tooltip"
          :data-testid="
            status.selected ? TID.updateActionButton(status.headerCheckAction.id) : undefined
          "
          @click="emit('action', status.headerCheckAction)"
        >
          <Loader2
            v-if="isActionRunning(status.headerCheckAction.id)"
            :size="14"
            class="channel-picker-action-spinner flex-none animate-spin [animation-duration:0.9s]"
          />
          {{ status.headerCheckAction.label }}
        </Button>
      </div>
    </div>

    <div class="channel-picker-card mt-4 flex flex-col gap-3">
      <h3
        class="channel-picker-channel-header m-0 inline-flex items-center gap-1 text-[11px]/4 font-medium tracking-[0.09em] text-subtle-foreground uppercase"
      >
        {{ field.label }}
        <InfoTooltip v-if="field.tooltip" :text="field.tooltip" />
      </h3>

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
        {{ t('channelCards.noInfo') }}
      </p>
      <p
        v-else-if="!draftIsCurrent && preview"
        class="channel-picker-switch-hint m-0 text-[12px] leading-4 text-text-muted"
      >
        {{ t('channelCards.switchTo', { channel: selectedOption?.label ?? '' }) }}
      </p>

      <div
        v-if="showFooterActions"
        class="channel-picker-actions mt-1 flex flex-wrap items-center justify-end gap-2"
      >
        <label
          v-if="footerToggle"
          class="channel-picker-footer-toggle mr-auto inline-flex cursor-pointer select-none items-center gap-2 text-[12px] leading-4 text-text-muted"
          :title="footerToggle.tooltip"
          :data-testid="TID.channelPickerFooterToggle"
        >
          <Checkbox
            :model-value="footerToggle.value === true"
            class="shrink-0"
            @update:model-value="emit('update-field', footerToggle, $event === true)"
          />
          <span>{{ footerToggle.label }}</span>
        </label>
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
