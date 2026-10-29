<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { ChevronRight, ShieldAlert } from 'lucide-vue-next'
import BaseInput from '../../components/ui/BaseInput.vue'
import BaseSelect, { type BaseSelectOption } from '../../components/ui/BaseSelect.vue'
import BooleanToggle from './BooleanToggle.vue'
import PathField from './PathField.vue'
import EnvVarsField from './EnvVarsField.vue'
import ChannelPicker from './ChannelPicker.vue'
import VersionStatPanel from './VersionStatPanel.vue'
import SectionActionButton from './SectionActionButton.vue'
import ArgsBuilderField from './ArgsBuilderField.vue'
import InfoTooltip from '../../components/InfoTooltip.vue'
import BaseCopyButton from '../../components/ui/BaseCopyButton.vue'
import TooltipWrap from '../../components/TooltipWrap.vue'
import { isOpenablePathString } from '../../lib/openablePath'
import type {
  ActionDef,
  DetailField,
  DetailSection,
  VersionStatRow,
  VersionStatsValue
} from '../../types/ipc'

/**
 * Shared section + field renderer for both the Settings drawer and the instance-picker's Settings accordion.
 * Pure presentation; the host wires the handlers so the same DOM serves panel (`window.api`) and popup (bridge) without either importing the other's IPC.
 */

interface Props {
  sections: DetailSection[]
  /** Status-tab styling: hairline dividers + label-over-value, no input chrome. */
  readonly?: boolean
  /** Installation context for install-scoped IPCs (e.g. ArgsBuilderField's `getComfyArgs(id)`). */
  installationId?: string
  /** Inline-action busy set driving per-button spinner/disabled state. */
  runningActionIds?: Set<string>
  /** Field ids edited while running that need a restart; renders a tag next to the label. */
  pendingRestartFieldIds?: Set<string>
  /** Per-field error messages from failed `updateInstallation` IPCs; renders a red inline pill. */
  fieldErrorMessages?: Map<string, string>
}

const props = withDefaults(defineProps<Props>(), {
  readonly: false,
  installationId: undefined,
  runningActionIds: () => new Set<string>(),
  pendingRestartFieldIds: () => new Set<string>(),
  fieldErrorMessages: () => new Map<string, string>()
})

// Wrap in a computed so each `.has()` tracks a reactive dep (bare access on a destructured prop can miss it).
const runningIdsSet = computed(() => props.runningActionIds ?? new Set<string>())
function isActionRunning(actionId: string): boolean {
  return runningIdsSet.value.has(actionId)
}

const pendingRestartSet = computed(() => props.pendingRestartFieldIds ?? new Set<string>())
function needsRestartTag(field: DetailField): boolean {
  return !!field.requiresRestart && pendingRestartSet.value.has(field.id)
}

const errorMessagesMap = computed(() => props.fieldErrorMessages ?? new Map<string, string>())
function fieldErrorMessage(field: DetailField): string | null {
  return errorMessagesMap.value.get(field.id) ?? null
}

const emit = defineEmits<{
  'update-field': [field: DetailField, value: unknown]
  'run-action': [action: ActionDef]
  'open-args-page': [field: DetailField]
  /** Open a filesystem path in the OS file manager; the host wires the IPC
   *  (`window.api.openPath` in the panel, the bridge in the title popup). */
  'open-path': [path: string]
}>()

const { t } = useI18n()

function asString(v: DetailField['value']): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

/** Unpack a `version-stats` field. The backend owns the wording - it knows what
 *  the versions mean - so this only supplies defaults for a malformed payload. */
function versionStats(field: DetailField): Required<VersionStatsValue> {
  const v = (field.value ?? {}) as Partial<VersionStatsValue>
  return {
    headline: typeof v.headline === 'string' ? v.headline : '',
    headlineHighlight: v.headlineHighlight === true,
    badge: typeof v.badge === 'string' ? v.badge : null,
    badgeTone: v.badgeTone === 'update' ? 'update' : 'current',
    rows: Array.isArray(v.rows) ? v.rows.filter(isVersionStatRow) : []
  }
}

/** Guards each row before VersionStatPanel dereferences `id`/`label`/`value`:
 *  a malformed IPC payload (e.g. a null entry) must not break the render. */
function isVersionStatRow(r: unknown): r is VersionStatRow {
  if (r === null || typeof r !== 'object') return false
  const row = r as Partial<VersionStatRow>
  return (
    typeof row.id === 'string' && typeof row.label === 'string' && typeof row.value === 'string'
  )
}

// Per-title collapse state; only titled sections (with a `section.collapsed` seed) are collapsible.
const collapsedTitles = ref(new Set<string>())

watch(
  () => props.sections,
  (sections) => {
    for (const s of sections) {
      if (s.title && s.collapsed === true && !collapsedTitles.value.has(s.title)) {
        collapsedTitles.value.add(s.title)
      }
    }
  },
  { immediate: true }
)

function isCollapsible(section: { title?: string; collapsed?: boolean }): boolean {
  return Boolean(section.title) && section.collapsed !== undefined
}

function isCollapsed(section: { title?: string }): boolean {
  return section.title ? collapsedTitles.value.has(section.title) : false
}

function toggleCollapsed(section: { title?: string }): void {
  if (!section.title) return
  if (collapsedTitles.value.has(section.title)) {
    collapsedTitles.value.delete(section.title)
  } else {
    collapsedTitles.value.add(section.title)
  }
}

const visibleSections = computed(() => props.sections)

function isNestedField(field: DetailField): boolean {
  return field.nested === true
}

/** Field types that render the section's actions themselves, so the generic
 *  full-width footer must stand down or the buttons appear twice. */
const ACTION_OWNING_EDIT_TYPES = new Set(['channel-cards', 'version-stats'])

function fieldOwnsSectionActions(section: DetailSection): boolean {
  return (section.fields ?? []).some((f) => f.editType && ACTION_OWNING_EDIT_TYPES.has(f.editType))
}

/** Chunk a section's fields into rows: consecutive fields sharing a
 *  `rowGroup` render side-by-side; everything else gets its own row.
 *  Only adjacency groups, so unrelated fields never merge. */
function fieldRows(section: DetailSection): DetailField[][] {
  const rows: DetailField[][] = []
  for (const field of section.fields ?? []) {
    const prev = rows[rows.length - 1]
    if (field.rowGroup && prev && prev[0]?.rowGroup === field.rowGroup) {
      prev.push(field)
    } else {
      rows.push([field])
    }
  }
  return rows
}

function rowKey(row: DetailField[]): string {
  return row.map((f) => f.id).join('|')
}

function isPathLikeValue(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (!v || v === '\u2014') return false
  return v.includes('/') || v.includes('\\') || v.startsWith('~')
}

/** Stricter than `isPathLikeValue`: only values safe to open in the OS file
 *  manager. `editType === 'path'` is openable when it holds a real value (not
 *  empty or the em dash placeholder); otherwise the value must look like a local
 *  path (not a URL, SSH remote, or date). */
function canOpenFilesystemPath(field: DetailField): boolean {
  const v = asString(field.value).trim()
  if (field.editType === 'path') return v.length > 0 && v !== '\u2014'
  return isOpenablePathString(v)
}

function readonlyDisplayValue(field: DetailField): string {
  return asString(field.value)
}

function fieldOwnsLabel(field: DetailField): boolean {
  return (
    field.editType === 'env-vars' ||
    field.editType === 'channel-cards' ||
    // The panel leads with its own headline; a label above it would echo the
    // section title.
    field.editType === 'version-stats'
  )
}

const sectionTitleClass = computed(() =>
  props.readonly
    ? 'pt-2 pb-1 m-0 leading-[1.5] text-[11px] font-semibold tracking-[0.04em] uppercase text-text-muted opacity-55'
    : 'leading-[1.5] text-[length:var(--takeover-fs-body)] font-medium text-text-muted'
)

function actionButtonClass(running = false, itemRow = false, looksDisabled = false): string {
  const base =
    'settings-v2-action static inline-flex w-full items-center justify-center gap-1.5 rounded-lg border-none px-4 py-2 text-[14px] font-normal whitespace-normal appearance-auto transition-none focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] disabled:pointer-events-auto'
  return `${base} ${itemRow ? 'leading-[1.4]' : 'leading-[1.5]'} ${running ? 'is-running cursor-progress opacity-85 disabled:cursor-progress disabled:opacity-85' : looksDisabled ? 'cursor-default opacity-40 disabled:cursor-default disabled:opacity-40' : 'disabled:cursor-default disabled:opacity-40'}`
}

// Item actions forward every style; the shared footer historically styled only primary and danger.
function actionVariantClass(action: ActionDef, directStyle = true): string {
  switch (action.style) {
    case 'primary':
      return 'bg-[var(--accent-primary)] text-background font-medium hover:bg-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] enabled:hover:bg-[var(--accent-hover)] hover:transition-[background,border-color] hover:duration-[120ms] hover:ease-[ease]'
    case 'accent':
      return directStyle
        ? 'bg-[var(--surface)] text-[var(--accent)] font-semibold hover:bg-[var(--accent)] hover:text-[var(--bg)]'
        : 'bg-[var(--surface)] text-text hover:bg-[var(--border)]'
    case 'danger':
      return 'bg-[var(--surface)] text-danger hover:bg-[var(--danger)] hover:text-[var(--bg)]'
    default:
      return 'bg-[var(--surface)] text-text hover:bg-[var(--border)]'
  }
}
</script>

<template>
  <div class="settings-v2-sections flex flex-col gap-8">
    <article
      v-for="(section, si) in visibleSections"
      :key="`s-${si}`"
      class="settings-v2-section flex flex-col"
      :class="[
        readonly
          ? 'is-readonly-list gap-0 rounded-[10px] border border-solid border-[var(--chooser-surface-border)] bg-[var(--secondary-background)] px-3 py-1'
          : 'gap-4',
        {
          'is-collapsible': isCollapsible(section),
          'is-collapsed [&>*:not(.settings-v2-section-title)]:hidden':
            isCollapsible(section) && isCollapsed(section)
        }
      ]"
    >
      <Button
        v-if="isCollapsible(section)"
        variant="textonly"
        size="unset"
        type="button"
        class="settings-v2-section-title is-toggle static inline-flex items-center gap-1 self-start rounded-lg border-none bg-transparent p-0 text-left text-text-muted whitespace-normal appearance-auto hover:bg-transparent hover:text-text focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color]"
        :class="sectionTitleClass"
        :aria-expanded="!isCollapsed(section)"
        @click="toggleCollapsed(section)"
      >
        <ChevronRight
          :size="14"
          class="settings-v2-section-chevron text-text-muted transition-transform duration-[160ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
          :class="{ 'is-open [transform:rotate(90deg)]': !isCollapsed(section) }"
        />
        {{ section.title }}
      </Button>

      <p
        v-else-if="section.title && readonly"
        class="settings-v2-section-title settings-v2-section-title--readonly"
        :class="sectionTitleClass"
      >
        {{ section.title }}
      </p>

      <p
        v-if="section.description && !isCollapsed(section)"
        class="settings-v2-section-desc -mt-1 mb-1 text-[length:var(--takeover-fs-caption)] leading-[1.4] text-text-muted"
      >
        {{ section.description }}
      </p>

      <div
        v-for="(item, i) in section.items"
        :key="`i-${i}`"
        class="settings-v2-item flex items-center justify-between gap-2 text-[length:var(--takeover-fs-body)] leading-[1.4] text-text"
      >
        <span class="settings-v2-item-label inline-flex min-w-0 flex-1 items-center gap-1.5">
          {{ item.label }}{{ item.active ? ` (${t('common.active', 'active')})` : '' }}
          <span
            v-if="item.tag"
            class="settings-v2-item-tag rounded-[999px] bg-[color-mix(in_srgb,var(--text)_8%,transparent)] px-1.5 py-0.5 text-[length:var(--takeover-fs-caption)] font-medium text-text-muted"
            >{{ item.tag }}</span
          >
        </span>
        <span
          v-if="item.actions && item.actions.length"
          class="settings-v2-item-actions inline-flex shrink-0 items-center gap-1.5"
        >
          <TooltipWrap
            v-for="a in item.actions"
            :key="a.id"
            :text="a.enabled === false && a.disabledMessage ? a.disabledMessage : a.tooltip"
          >
            <Button
              variant="textonly"
              size="unset"
              type="button"
              :class="[
                actionButtonClass(false, true),
                actionVariantClass(a),
                { 'opacity-40 cursor-default': a.enabled === false && a.disabledMessage }
              ]"
              :disabled="a.enabled === false && !a.disabledMessage"
              @click="emit('run-action', a)"
            >
              {{ a.label }}
            </Button>
          </TooltipWrap>
        </span>
      </div>

      <div
        v-for="row in fieldRows(section)"
        :key="rowKey(row)"
        class="settings-v2-field-row"
        :class="[
          row.length > 1 ? 'is-paired flex flex-wrap gap-4' : 'contents',
          { '[&:last-child>.settings-v2-field]:border-b-0': readonly }
        ]"
      >
        <!-- `data-field-id` is the only per-row anchor a settings deep link has to aim at
             (e.g. the beta activation notice pointing at the beta opt-in switch): the row is
             rendered several components below whoever opened the popup, so there is no
             template ref to hand out. -->
        <div
          v-for="field in row"
          :key="field.id"
          :data-field-id="field.id"
          class="settings-v2-field"
          :class="[
            readonly
              ? 'grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-start gap-x-4 gap-y-2 border-b border-solid border-[var(--chooser-surface-border)] px-0 py-2.5'
              : 'flex flex-col gap-2.5',
            {
              'min-w-0 flex-[1_1_240px]': row.length > 1,
              'is-boolean-row': field.editType === 'boolean',
              'is-nested -mt-2 border-l border-solid border-l-[color-mix(in_srgb,var(--chooser-surface-border)_70%,transparent)]':
                isNestedField(field),
              'pl-3.5': isNestedField(field) && !readonly,
              'is-env-vars': field.editType === 'env-vars',
              'is-channel-picker': field.editType === 'channel-cards'
            }
          ]"
        >
          <template v-if="field.editType === 'env-vars'">
            <div class="settings-v2-env-header flex items-start justify-between gap-3">
              <label
                class="settings-v2-field-label inline-flex w-fit max-w-full items-center gap-0.5 text-[12px] leading-4 font-normal text-text-muted flex-auto min-w-0"
              >
                <span class="settings-v2-field-label-text min-w-0 flex-[0_1_auto]">{{
                  field.label
                }}</span>
                <InfoTooltip v-if="field.tooltip" :text="field.tooltip" />
                <span
                  v-if="needsRestartTag(field)"
                  class="settings-v2-restart-tag ml-1.5 flex-none rounded-[9999px] border border-solid border-[color-mix(in_srgb,var(--warning)_36%,transparent)] bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] px-1.5 py-px text-[10px] leading-[14px] font-medium tracking-[0.02em] whitespace-nowrap text-[var(--warning)] uppercase"
                  role="status"
                >
                  {{ t('comfyUISettings.restartRequired', 'Restart to apply') }}
                </span>
                <span
                  v-if="fieldErrorMessage(field)"
                  class="settings-v2-field-error-tag ml-1.5 max-w-60 flex-none truncate rounded-[9999px] border border-solid border-[color-mix(in_srgb,var(--danger)_36%,transparent)] bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] px-1.5 py-px text-[10px] leading-[14px] font-medium tracking-[0.02em] text-danger"
                  role="alert"
                  :title="fieldErrorMessage(field) ?? ''"
                >
                  {{ fieldErrorMessage(field) }}
                </span>
              </label>
              <div
                class="settings-v2-env-notice -my-1.5 ml-auto inline-flex w-fit max-w-[min(100%,320px)] flex-none items-start gap-1.5 rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--chooser-surface-bg)] px-2 py-1.5 text-left text-[10.5px] leading-4 text-text-muted"
                role="note"
              >
                <ShieldAlert
                  :size="14"
                  class="settings-v2-env-notice-icon mt-px shrink-0 text-neutral-100"
                  aria-hidden="true"
                />
                <span class="settings-v2-env-notice-text min-w-0">
                  {{
                    t('envVars.securityWarningShort', 'Environment variables may contain secrets')
                  }}
                </span>
              </div>
            </div>
            <EnvVarsField :field="field" @update="(f, v) => emit('update-field', f, v)" />
          </template>

          <div
            v-else-if="field.editType === 'boolean'"
            class="settings-v2-boolean-row flex min-h-11 items-center justify-between gap-3 py-1"
          >
            <label
              class="settings-v2-field-label inline-flex w-fit max-w-[calc(100%_-_48px)] items-center gap-0.5 text-[12px] leading-4 font-normal text-text-muted flex-[0_1_auto]"
            >
              <span class="settings-v2-field-label-text min-w-0 flex-[0_1_auto]">{{
                field.label
              }}</span>
              <InfoTooltip v-if="field.tooltip" :text="field.tooltip" />
              <span
                v-if="needsRestartTag(field)"
                class="settings-v2-restart-tag ml-1.5 flex-none rounded-[9999px] border border-solid border-[color-mix(in_srgb,var(--warning)_36%,transparent)] bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] px-1.5 py-px text-[10px] leading-[14px] font-medium tracking-[0.02em] whitespace-nowrap text-[var(--warning)] uppercase"
                role="status"
              >
                {{ t('comfyUISettings.restartRequired', 'Restart to apply') }}
              </span>
            </label>
            <BooleanToggle
              :field="field"
              :turn-on-disabled="field.turnOnDisabled"
              :turn-on-disabled-tooltip-key="field.turnOnDisabledTooltipKey"
              @update="(v) => emit('update-field', field, v)"
            />
          </div>

          <template v-else>
            <label
              v-if="!fieldOwnsLabel(field) && field.label"
              class="settings-v2-field-label inline-flex w-fit max-w-full items-center gap-0.5 text-[12px] leading-4 font-normal text-text-muted"
            >
              <span class="settings-v2-field-label-text min-w-0 flex-[0_1_auto]">{{
                field.label
              }}</span>
              <InfoTooltip v-if="field.tooltip" :text="field.tooltip" />
              <span
                v-if="needsRestartTag(field)"
                class="settings-v2-restart-tag ml-1.5 flex-none rounded-[9999px] border border-solid border-[color-mix(in_srgb,var(--warning)_36%,transparent)] bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] px-1.5 py-px text-[10px] leading-[14px] font-medium tracking-[0.02em] whitespace-nowrap text-[var(--warning)] uppercase"
                role="status"
              >
                {{ t('comfyUISettings.restartRequired', 'Restart to apply') }}
              </span>
            </label>

            <PathField
              v-if="field.editType === 'path' && !readonly"
              :field="field"
              @update="(f, v) => emit('update-field', f, v)"
            />

            <div
              v-else-if="readonly && (field.editType === 'path' || isPathLikeValue(field.value))"
              class="settings-v2-readonly-path flex min-w-0 items-center gap-2 justify-self-stretch w-full text-right"
            >
              <Button
                v-if="canOpenFilesystemPath(field)"
                variant="textonly"
                size="unset"
                type="button"
                class="settings-v2-field-readonly settings-v2-field-readonly-path settings-v2-field-readonly-open static inline-block w-full min-w-0 flex-[0_1_auto] justify-self-end truncate rounded-lg border-none bg-transparent p-0 text-right text-[13px] leading-[19px] font-normal text-neutral-100 [font-family:inherit] appearance-auto hover:bg-transparent hover:text-[var(--accent)] hover:underline focus-visible:text-[var(--accent)] focus-visible:underline focus-visible:outline-none focus-visible:ring-0"
                :title="t('models.openDir', 'Open folder')"
                :aria-label="`${t('models.openDir', 'Open folder')}: ${readonlyDisplayValue(field)}`"
                @click="emit('open-path', readonlyDisplayValue(field))"
              >
                {{ readonlyDisplayValue(field) }}
              </Button>
              <span
                v-else
                class="settings-v2-field-readonly text-[13px] leading-[19px] text-neutral-100 w-full text-right justify-self-end settings-v2-field-readonly-path min-w-0 flex-1 truncate"
                >{{ readonlyDisplayValue(field) }}</span
              >
              <BaseCopyButton :value="readonlyDisplayValue(field)" />
            </div>

            <BaseSelect
              v-else-if="field.editType === 'select'"
              :model-value="asString(field.value)"
              :options="
                (field.options ?? []).map(
                  (opt): BaseSelectOption => ({
                    value: opt.value,
                    label: opt.label,
                    description: opt.description
                  })
                )
              "
              :aria-label="field.label"
              @update:model-value="(v: string) => emit('update-field', field, v)"
            />

            <ArgsBuilderField
              v-else-if="field.editType === 'args-builder'"
              :field="field"
              :installation-id="props.installationId"
              @open="emit('open-args-page', field)"
              @update="(f, v) => emit('update-field', f, v)"
            />

            <ChannelPicker
              v-else-if="field.editType === 'channel-cards'"
              :field="field"
              :section-actions="section.actions ?? []"
              :running-action-ids="runningIdsSet"
              @action="(a) => emit('run-action', a)"
            />

            <VersionStatPanel
              v-else-if="field.editType === 'version-stats'"
              v-bind="versionStats(field)"
              :actions="section.actions ?? []"
              :running-action-ids="runningIdsSet"
              @action="(a) => emit('run-action', a)"
            />

            <BaseInput
              v-else-if="field.editType === 'text'"
              :model-value="asString(field.value)"
              :aria-label="field.label"
              :placeholder="field.placeholder"
              @change="(v: string) => emit('update-field', field, v)"
            />

            <BaseInput
              v-else-if="field.editType === 'number'"
              :model-value="asString(field.value)"
              :aria-label="field.label"
              type="number"
              :min="field.min"
              :max="field.max"
              @change="(v: string) => emit('update-field', field, v === '' ? null : Number(v))"
            />

            <span
              v-else
              class="settings-v2-field-readonly text-[13px] leading-[19px] text-neutral-100"
              :class="{ 'w-full text-right justify-self-end': readonly }"
              >{{ asString(field.value) }}</span
            >
          </template>

          <p
            v-if="field.description"
            class="settings-v2-field-description -mt-0.5 mb-0 flex items-start gap-1.5 text-[11.5px] leading-[1.45] text-text-muted"
            role="note"
          >
            <ShieldAlert
              :size="14"
              class="settings-v2-field-description-icon mt-0.5 shrink-0 text-[var(--info,var(--neutral-100))]"
              aria-hidden="true"
            />
            <span>{{ field.description }}</span>
          </p>
        </div>
      </div>

      <div
        v-if="section.actions && section.actions.length && !fieldOwnsSectionActions(section)"
        class="settings-v2-actions mt-2 flex flex-wrap gap-2 [&:has(>.settings-v2-action-tooltip:only-child)_.settings-v2-action]:flex-1"
      >
        <SectionActionButton
          v-for="action in section.actions"
          :key="action.id"
          :action="action"
          :running="isActionRunning(action.id)"
          :button-class="
            actionButtonClass(
              isActionRunning(action.id),
              false,
              action.enabled === false && !!action.disabledMessage
            )
          "
          :variant-class="actionVariantClass(action, false)"
          tooltip-class="settings-v2-action-tooltip w-full"
          spinner-class="settings-v2-action-spinner flex-none animate-spin [animation-duration:0.9s]"
          @action="emit('run-action', action)"
        />
      </div>
    </article>
  </div>
</template>
