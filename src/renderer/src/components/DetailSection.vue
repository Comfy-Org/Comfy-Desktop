<script setup lang="ts">
// TODO(stale-old-modal): delete after Settings drawer (v2,
// ComfyUISettingsPanel) reaches functional parity and ships everywhere.
import { ref, reactive, watch, nextTick } from 'vue'
import type { DetailItem, DetailField, DetailFieldOption, ActionDef } from '../types/ipc'
import InfoTooltip from './InfoTooltip.vue'
import Button from '@comfyorg/design-system/button/Button'
import TooltipWrap from './TooltipWrap.vue'
import EnvVarsEditor from './EnvVarsEditor.vue'
import { isOpenablePathString } from '../lib/openablePath'

interface Props {
  title?: string
  description?: string
  collapsed?: boolean | null
  items?: DetailItem[]
  fields?: DetailField[]
  actions?: ActionDef[]
  installationId: string
}

const props = withDefaults(defineProps<Props>(), {
  title: undefined,
  description: undefined,
  collapsed: null,
  items: undefined,
  fields: undefined,
  actions: undefined
})

const actionButtonClass =
  '[appearance:button] rounded-lg border border-solid px-4 py-2 font-sans text-[14px] leading-[1.5] font-normal whitespace-normal transition-none disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40 focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto]'
const actionVariants = {
  primary: 'inverted',
  accent: 'outline',
  danger: 'outline',
  default: 'secondary'
} as const
const actionClasses = {
  default: 'border-[var(--border)] bg-surface text-text hover:bg-[var(--border)]',
  primary:
    'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-background font-medium hover:border-[var(--accent-hover)] hover:bg-[var(--accent-hover)] hover:transition-[background,border-color] hover:duration-[120ms] hover:ease-[ease]',
  accent:
    'border-[var(--accent)] bg-surface text-[var(--accent)] font-semibold hover:bg-[var(--accent)] hover:text-bg',
  danger: 'border-danger bg-surface text-danger hover:bg-danger hover:text-bg'
} as const
const fieldControlClass =
  'w-full rounded-md border border-solid border-[var(--border)] bg-surface text-[14px] text-text outline-none focus:border-[var(--accent)] disabled:opacity-40'
const collapsibleTitleClass =
  "inline-block cursor-pointer select-none before:mr-1 before:inline-block before:content-['▸'] before:transition-transform before:duration-150 before:ease-[ease]"
const openPathClass =
  'min-w-0 border-0 bg-transparent p-0 text-left text-[14px] text-text hover:bg-transparent hover:text-[var(--accent)] hover:underline focus-visible:bg-transparent focus-visible:text-[var(--accent)] focus-visible:underline focus-visible:outline-none'

const emit = defineEmits<{
  'run-action': [action: ActionDef, button: HTMLButtonElement | null]
  refresh: [sectionTitle: string]
}>()

const isCollapsed = ref(props.collapsed === true)
const sectionRef = ref<HTMLDivElement | null>(null)

// Channel-cards local selection before committing.
const draftValues = reactive<Record<string, string>>({})

function getDraft(f: DetailField): string {
  return draftValues[f.id] ?? String(f.value)
}

function getSelectedOption(f: DetailField): DetailFieldOption | undefined {
  const draft = getDraft(f)
  return f.options?.find((o) => o.value === draft)
}

// Template-friendly: prettier's Vue parser can't handle generic casts in expressions.
function getSelectedData(f: DetailField): Record<string, unknown> {
  return (getSelectedOption(f)?.data ?? {}) as Record<string, unknown>
}

function getSelectedActions(f: DetailField): ActionDef[] | undefined {
  return getSelectedData(f).actions as ActionDef[] | undefined
}

// Reset draft when the committed value changes (e.g. after refresh).
watch(
  () => props.fields,
  () => {
    for (const f of props.fields ?? []) {
      if (f.editType === 'channel-cards' && draftValues[f.id] === String(f.value)) {
        delete draftValues[f.id]
      }
    }
  },
  { deep: true }
)

async function toggleCollapse(): Promise<void> {
  if (props.collapsed != null) {
    isCollapsed.value = !isCollapsed.value
    if (!isCollapsed.value) {
      await nextTick()
      sectionRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }
}

async function handleFieldChange(
  field: DetailField,
  value: string | boolean | Record<string, string>
): Promise<void> {
  // Update local value immediately so tab switches reflect the change.
  field.value = value
  await window.api.updateInstallation(props.installationId, { [field.id]: value })
  if (field.refreshSection && props.title) {
    emit('refresh', props.title)
  }
}

function handleItemAction(action: ActionDef, event: MouseEvent): void {
  const button = event.currentTarget as HTMLButtonElement | null
  emit('run-action', action, button)
}

function handleAction(action: ActionDef, event: MouseEvent): void {
  const button = event.currentTarget as HTMLButtonElement | null
  emit('run-action', action, button)
}

async function handleBrowseField(field: DetailField): Promise<void> {
  const current = field.value ? String(field.value) : undefined
  const dir = await window.api.browseFolder(current)
  if (dir) {
    await handleFieldChange(field, dir)
  }
}

/** True when a non-editable value is safe to open in the OS file manager:
 *  an explicit path field, or a local-looking path (not a URL, SSH remote, or
 *  date). */
function canOpenFieldValue(field: DetailField): boolean {
  const v = field.value == null ? '' : String(field.value).trim()
  if (field.editType === 'path') return v.length > 0
  return isOpenablePathString(v)
}

function handleOpenPath(value: unknown): void {
  const p = value == null ? '' : String(value).trim()
  if (p) void window.api.openPath(p)
}
</script>

<template>
  <div ref="sectionRef" class="detail-section mb-4" :data-section-title="title">
    <div
      v-if="title"
      class="detail-section-title mb-2 text-[13px] font-semibold tracking-[0.5px] text-text-muted uppercase"
      :class="[
        collapsed != null ? collapsibleTitleClass : '',
        { 'before:rotate-90': collapsed != null && !isCollapsed }
      ]"
      :data-collapsed="isCollapsed ? 'true' : 'false'"
      @click="toggleCollapse"
    >
      {{ title }}
    </div>
    <div v-show="!isCollapsed" class="detail-section-body">
      <div v-if="description" class="detail-section-desc mb-2 text-[14px] text-text-muted">
        {{ description }}
      </div>

      <div
        v-if="items?.length"
        class="detail-item-list mb-2 rounded-lg border border-solid border-[var(--border)] bg-surface"
      >
        <div
          v-for="item in items"
          :key="item.label"
          class="detail-item flex items-center justify-between px-4 py-2 [&+&]:border-t [&+&]:border-solid [&+&]:border-[var(--border)]"
          :class="{ active: item.active }"
        >
          <div
            class="detail-item-label flex min-w-0 items-center gap-2 text-[14px]"
            :class="{ 'font-semibold': item.active }"
          >
            {{ item.label }}{{ item.active ? ' (active)' : ''
            }}<span
              v-if="item.tag"
              class="detail-item-tag shrink-0 rounded-[3px] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]"
              >{{ item.tag }}</span
            >
          </div>
          <div v-if="item.actions" class="detail-item-actions flex gap-1.5">
            <Button
              v-for="a in item.actions"
              :key="a.id"
              type="button"
              size="unset"
              :variant="actionVariants[a.style ?? 'default']"
              :class="[
                actionButtonClass,
                actionClasses[a.style ?? 'default'],
                'px-2.5 py-[3px] text-[13px]'
              ]"
              :disabled="a.enabled === false && !a.disabledMessage"
              @click="handleItemAction(a, $event)"
            >
              {{ a.label }}
            </Button>
          </div>
        </div>
      </div>

      <div
        v-if="fields?.length"
        class="detail-fields flex flex-col gap-2.5 rounded-lg border border-solid border-[var(--border)] bg-surface px-4 py-3"
      >
        <div v-for="f in fields" :key="f.id">
          <template v-if="f.editable && f.editType === 'channel-cards'">
            <div class="detail-field-label text-[13px] text-text-muted">
              {{ f.label }}<InfoTooltip v-if="f.tooltip" :text="f.tooltip" />
            </div>
            <select
              class="detail-field-input channel-select mt-1 max-w-[360px] px-2 py-1.5"
              :class="fieldControlClass"
              :value="getDraft(f)"
              @change="draftValues[f.id] = ($event.target as HTMLSelectElement).value"
            >
              <option v-for="opt in f.options" :key="opt.value" :value="opt.value">
                {{ opt.label
                }}{{ String(f.value) === opt.value ? ` — ${$t('channelCards.current')}` : ''
                }}{{
                  String(f.value) !== opt.value && opt.recommended
                    ? ` — ${$t('newInstall.recommended')}`
                    : ''
                }}
              </option>
            </select>
            <div
              v-if="getSelectedOption(f)?.description"
              class="channel-select-desc mt-1.5 text-[12px] text-text-muted"
            >
              {{ getSelectedOption(f)!.description }}
            </div>
            <div
              v-if="getSelectedOption(f)?.data"
              class="channel-preview mt-2.5 rounded-lg border border-solid border-[var(--border)] bg-surface px-3.5 py-2.5"
            >
              <div class="channel-preview-row flex justify-between py-[3px]">
                <span class="channel-preview-label text-[13px] text-text-muted">{{
                  $t('channelCards.installedVersion')
                }}</span>
                <span class="channel-preview-value text-[13px] text-text">{{
                  getSelectedData(f).installedVersion
                }}</span>
              </div>
              <div class="channel-preview-row flex justify-between py-[3px]">
                <span class="channel-preview-label text-[13px] text-text-muted">{{
                  $t('channelCards.latestVersion')
                }}</span>
                <span class="channel-preview-value text-[13px] text-text">{{
                  getSelectedData(f).latestVersion
                }}</span>
              </div>
              <div class="channel-preview-row flex justify-between py-[3px]">
                <span class="channel-preview-label text-[13px] text-text-muted">{{
                  $t('channelCards.lastChecked')
                }}</span>
                <span class="channel-preview-value text-[13px] text-text">{{
                  getSelectedData(f).lastChecked
                }}</span>
              </div>
              <!-- "Up to date" is suppressed for cards that opt out (PyTorch:
                   other stacks stay selectable, so it would be misleading). -->
              <div
                v-if="getSelectedData(f).updateAvailable || !getSelectedData(f).hideUpToDateBadge"
                class="channel-preview-row flex justify-between py-[3px]"
              >
                <span class="channel-preview-label text-[13px] text-text-muted">{{
                  $t('channelCards.status')
                }}</span>
                <span class="channel-preview-value text-[13px] text-text">{{
                  getSelectedData(f).updateAvailable
                    ? $t('channelCards.updateAvailable')
                    : $t('channelCards.upToDate')
                }}</span>
              </div>
            </div>
            <div
              v-else-if="getDraft(f) !== String(f.value)"
              class="channel-preview channel-preview-empty mt-2.5 rounded-lg border border-solid border-[var(--border)] bg-surface px-3.5 py-2.5 text-[13px] text-text-muted"
            >
              {{ $t('channelCards.noInfo') }}
            </div>
            <div
              v-if="getSelectedActions(f)?.length"
              class="channel-actions mt-2.5 flex items-center gap-2"
            >
              <span
                v-if="getDraft(f) !== String(f.value)"
                class="channel-switch-hint mr-1 text-[13px] text-text-muted"
              >
                {{ $t('channelCards.switchTo', { channel: getSelectedOption(f)?.label }) }}
              </span>
              <TooltipWrap v-for="a in getSelectedActions(f)" :key="a.id" :text="a.tooltip">
                <Button
                  type="button"
                  size="unset"
                  :variant="actionVariants[a.style ?? 'default']"
                  :class="[
                    actionButtonClass,
                    actionClasses[a.style ?? 'default'],
                    {
                      'looks-disabled opacity-40 cursor-default':
                        a.enabled === false && a.disabledMessage
                    }
                  ]"
                  :disabled="a.enabled === false && !a.disabledMessage"
                  @click="handleAction(a, $event)"
                >
                  {{ a.label }}
                </Button>
              </TooltipWrap>
            </div>
          </template>
          <template v-else-if="f.editable && f.editType === 'env-vars'">
            <div class="detail-field-label text-[13px] text-text-muted">
              {{ f.label }}<InfoTooltip v-if="f.tooltip" :text="f.tooltip" />
            </div>
            <EnvVarsEditor
              :model-value="(f.value as Record<string, string>) ?? {}"
              @update:model-value="handleFieldChange(f, $event)"
            />
          </template>
          <template v-else>
            <div class="detail-field-label text-[13px] text-text-muted">
              {{ f.label }}<InfoTooltip v-if="f.tooltip" :text="f.tooltip" />
            </div>
            <select
              v-if="f.editable && f.editType === 'select'"
              class="detail-field-input mt-1 px-2 py-1.5"
              :class="fieldControlClass"
              :value="f.value"
              @change="handleFieldChange(f, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="opt in f.options" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
            <input
              v-else-if="f.editable && f.editType === 'boolean'"
              type="checkbox"
              class="detail-field-toggle relative mt-2 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-[10px] bg-[var(--border)] transition-[background] duration-200 ease-[ease] after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-text after:content-[''] after:transition-transform after:duration-200 after:ease-[ease] checked:bg-[var(--accent)] checked:after:bg-background checked:after:[transform:translateX(16px)]"
              :checked="f.value !== false"
              @change="handleFieldChange(f, ($event.target as HTMLInputElement).checked)"
            />
            <div
              v-else-if="f.editable && f.editType === 'path'"
              class="detail-path-input mt-1.5 flex gap-2 [&>button]:shrink-0"
            >
              <div
                v-if="f.browseOnly"
                class="detail-path-open-wrap mt-1 flex min-w-0 flex-1 items-center rounded-md border border-solid border-[var(--border)] bg-surface px-2 py-1.5"
              >
                <button
                  v-if="canOpenFieldValue(f)"
                  type="button"
                  class="detail-path-open max-w-full truncate"
                  :class="openPathClass"
                  :title="$t('actions.openDirectory', 'Open Directory')"
                  :aria-label="`${$t('actions.openDirectory', 'Open Directory')}: ${f.value}`"
                  @click="handleOpenPath(f.value)"
                >
                  {{ f.value }}
                </button>
              </div>
              <input
                v-else
                type="text"
                class="detail-field-input mt-0 flex-1 px-2.5 py-2"
                :class="fieldControlClass"
                :value="f.value ?? ''"
                @change="handleFieldChange(f, ($event.target as HTMLInputElement).value)"
              />
              <Button
                type="button"
                size="unset"
                variant="secondary"
                :class="[actionButtonClass, actionClasses.default]"
                @click="handleBrowseField(f)"
                >{{ $t('common.browse') }}</Button
              >
            </div>
            <input
              v-else-if="f.editable"
              type="text"
              class="detail-field-input mt-1.5 px-2.5 py-2"
              :class="fieldControlClass"
              :value="f.value ?? ''"
              @change="handleFieldChange(f, ($event.target as HTMLInputElement).value)"
            />
            <button
              v-else-if="canOpenFieldValue(f)"
              type="button"
              class="detail-field-value detail-field-value-open mt-px"
              :class="openPathClass"
              :title="$t('actions.openDirectory', 'Open Directory')"
              :aria-label="`${$t('actions.openDirectory', 'Open Directory')}: ${f.value}`"
              @click="handleOpenPath(f.value)"
            >
              {{ f.value }}
            </button>
            <div v-else class="detail-field-value mt-px text-[14px]">{{ f.value }}</div>
          </template>
        </div>
      </div>

      <div v-if="actions?.length" class="detail-actions mt-2 flex flex-wrap gap-2">
        <TooltipWrap v-for="a in actions" :key="a.id" :text="a.tooltip">
          <Button
            type="button"
            size="unset"
            :variant="actionVariants[a.style ?? 'default']"
            :class="[
              actionButtonClass,
              actionClasses[a.style ?? 'default'],
              {
                'looks-disabled opacity-40 cursor-default': a.enabled === false && a.disabledMessage
              }
            ]"
            :disabled="a.enabled === false && !a.disabledMessage"
            @click="handleAction(a, $event)"
          >
            {{ a.label }}
          </Button>
        </TooltipWrap>
      </div>
    </div>
  </div>
</template>
