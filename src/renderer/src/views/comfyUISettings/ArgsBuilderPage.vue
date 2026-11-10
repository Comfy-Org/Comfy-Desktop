<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import InputGroupButton from '@comfyorg/design-system/input-group/InputGroupButton'
import { AlertCircle, ArrowLeft, Loader2, Search, SearchX, X } from 'lucide-vue-next'
import BaseInput from '../../components/ui/BaseInput.vue'
import BaseSelect, { type BaseSelectOption } from '../../components/ui/BaseSelect.vue'
import ArgsRawInput from './ArgsRawInput.vue'
import type { ComfyArgDef } from '../../types/ipc'
import { parseArgs, serialize } from '../../lib/argsParser'
import { emitTelemetryAction } from '../../lib/telemetry'
import { scoreName } from '../../utils/fuzzyMatch'

interface Props {
  installationId: string
  initialValue: string
  pendingRestart?: boolean
}

const searchClearClass =
  '[&.args-page-search_.args-page-search-clear]:inline-flex [&.args-page-search_.args-page-search-clear]:items-center [&.args-page-search_.args-page-search-clear]:justify-center [&.args-page-search_.args-page-search-clear]:size-[22px] [&.args-page-search_.args-page-search-clear]:p-0 [&.args-page-search_.args-page-search-clear]:border-none [&.args-page-search_.args-page-search-clear]:bg-transparent [&.args-page-search_.args-page-search-clear]:text-text-muted [&.args-page-search_.args-page-search-clear]:rounded-[4px] [&.args-page-search_.args-page-search-clear]:cursor-pointer [&.args-page-search_.args-page-search-clear]:transition-[color,background-color] [&.args-page-search_.args-page-search-clear]:duration-[120ms] [&.args-page-search_.args-page-search-clear]:ease-[ease] [&.args-page-search_.args-page-search-clear:hover]:text-text [&.args-page-search_.args-page-search-clear:hover]:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] [&.args-page-search_.args-page-search-clear:focus-visible]:outline-2 [&.args-page-search_.args-page-search-clear:focus-visible]:[outline-style:solid] [&.args-page-search_.args-page-search-clear:focus-visible]:outline-[var(--action)] [&.args-page-search_.args-page-search-clear:focus-visible]:outline-offset-1'

const props = withDefaults(defineProps<Props>(), {
  pendingRestart: false
})

const emit = defineEmits<{
  back: []
  update: [value: string]
}>()

const { t } = useI18n()

function categoryLabel(key: string): string {
  return t(`comfyUISettings.argsCategory.${key}`)
}

const localValue = ref(props.initialValue)
const schema = ref<ComfyArgDef[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const search = ref('')

watch(
  () => props.initialValue,
  (next) => {
    if (next !== localValue.value) localValue.value = next
  }
)

async function fetchSchema(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    const result = await window.api.getComfyArgs(props.installationId)
    if (result?.args?.length) {
      schema.value = result.args
    } else if (result?.error) {
      loadError.value = result.error
    } else {
      loadError.value = t('comfyUISettings.argsSchemaUnavailable')
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

let pendingArgsChange: { argKey: string; valueKind: ComfyArgDef['type'] } | null = null

function flushArgsChanged(): void {
  const pending = pendingArgsChange
  if (!pending) return
  pendingArgsChange = null
  emitTelemetryAction('comfy.desktop.args.changed', {
    installation_id: props.installationId,
    arg_key: pending.argKey,
    value_kind: pending.valueKind
  })
}

const { start: scheduleArgsChanged, stop: cancelArgsChanged } = useTimeoutFn(
  flushArgsChanged,
  500,
  { immediate: false }
)

function emitArgsChanged(argKey: string, valueKind: ComfyArgDef['type']): void {
  pendingArgsChange = { argKey, valueKind }
  scheduleArgsChanged()
}

onMounted(() => {
  emitTelemetryAction('comfy.desktop.args.builder.opened', {
    installation_id: props.installationId
  })
  void fetchSchema()
})

onBeforeUnmount(() => {
  if (localValue.value !== props.initialValue) emit('update', localValue.value)
  cancelArgsChanged()
  flushArgsChanged()
})

const parsed = computed(() => parseArgs(localValue.value, schema.value))

function isActive(name: string): boolean {
  return parsed.value.known.has(name)
}

function getValue(name: string): string {
  return parsed.value.known.get(name) ?? ''
}

function commit(known: Map<string, string>): void {
  const next = serialize(known, parsed.value.extra, schema.value)
  localValue.value = next
  emit('update', next)
}

function toggleFlag(def: ComfyArgDef): void {
  const next = new Map(parsed.value.known)
  if (next.has(def.name)) {
    next.delete(def.name)
  } else {
    if (def.exclusiveGroup) {
      for (const a of schema.value) {
        if (a.exclusiveGroup === def.exclusiveGroup && a.name !== def.name) {
          next.delete(a.name)
        }
      }
    }
    next.set(def.name, '')
  }
  commit(next)
  emitArgsChanged(def.name, def.type)
}

function setValue(def: ComfyArgDef, value: string): void {
  const next = new Map(parsed.value.known)
  next.set(def.name, value)
  commit(next)
  emitArgsChanged(def.name, def.type)
}

function selectExclusive(group: string, name: string): void {
  const next = new Map(parsed.value.known)
  for (const a of schema.value) {
    if (a.exclusiveGroup === group) {
      next.delete(a.name)
    }
  }
  next.set(name, '')
  commit(next)
  const chosen = schema.value.find((a) => a.name === name)
  if (chosen) emitArgsChanged(chosen.name, chosen.type)
}

function clearExclusive(group: string): void {
  const next = new Map(parsed.value.known)
  for (const a of schema.value) {
    if (a.exclusiveGroup === group) next.delete(a.name)
  }
  commit(next)
}

function activeInGroup(group: string): string {
  for (const a of schema.value) {
    if (a.exclusiveGroup === group && parsed.value.known.has(a.name)) return a.name
  }
  return ''
}

function activeDefInGroup(group: string): ComfyArgDef | null {
  const name = activeInGroup(group)
  if (!name) return null
  return schema.value.find((a) => a.name === name) ?? null
}

function activeValueDefInGroup(group: string): ComfyArgDef | null {
  const def = activeDefInGroup(group)
  return def && def.type !== 'boolean' ? def : null
}

function clusterOptions(args: ComfyArgDef[]): BaseSelectOption[] {
  return [
    {
      value: '',
      label: t('comfyUISettings.argsExclusiveNone'),
      description: t('comfyUISettings.argsExclusiveNoneHint')
    },
    ...args.map((a) => ({ value: a.name, label: `--${a.name}`, description: a.help }))
  ]
}

function clusterSummary(args: ComfyArgDef[]): string {
  return args.map((a) => `--${a.name}`).join(' ')
}

function onExclusivePick(group: string, value: string): void {
  if (value === '') clearExclusive(group)
  else selectExclusive(group, value)
}

function scoreHelp(needle: string, help: string): number {
  if (!needle) return 1
  if (!help) return 0
  const wordBoundaryRe = new RegExp(`\\b${escapeRegExp(needle)}`, 'i')
  if (wordBoundaryRe.test(help)) return 500
  if (help.includes(needle)) return 200
  return 0
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function scoreArg(query: string, arg: ComfyArgDef): number {
  const tokens = query.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 1
  const name = arg.name.toLowerCase()
  const help = arg.help.toLowerCase()
  let total = 0
  for (const token of tokens) {
    const nameScore = scoreName(token, name)
    const helpScore = scoreHelp(token, help)
    const best = Math.max(nameScore, helpScore / 3)
    if (best === 0) return 0
    total += best
  }
  return total
}

interface GroupItem {
  kind: 'arg' | 'exclusive'
  arg?: ComfyArgDef
  group?: string
  args?: ComfyArgDef[]
}

const structuredGroups = computed(() => {
  const q = search.value.trim().toLowerCase()
  const scored = new Map<string, number>()
  for (const arg of schema.value) {
    const s = q ? scoreArg(q, arg) : 1
    if (s > 0) scored.set(arg.name, s)
  }

  function groupScore(exclusiveGroup: string): number {
    let best = 0
    for (const a of schema.value) {
      if (a.exclusiveGroup === exclusiveGroup) {
        const s = scored.get(a.name) ?? 0
        if (s > best) best = s
      }
    }
    return best
  }

  const groups = new Map<string, ComfyArgDef[]>()
  for (const arg of schema.value) {
    if (q && !scored.has(arg.name)) continue
    const list = groups.get(arg.category) ?? []
    list.push(arg)
    groups.set(arg.category, list)
  }

  const result = new Map<string, GroupItem[]>()
  const seenExclusive = new Set<string>()
  for (const [category, args] of groups) {
    const items: { item: GroupItem; score: number }[] = []
    for (const arg of args) {
      if (arg.exclusiveGroup) {
        if (seenExclusive.has(arg.exclusiveGroup)) continue
        seenExclusive.add(arg.exclusiveGroup)
        const siblings = schema.value.filter((a) => a.exclusiveGroup === arg.exclusiveGroup)
        if (siblings.length > 1) {
          items.push({
            item: { kind: 'exclusive', group: arg.exclusiveGroup, args: siblings },
            score: groupScore(arg.exclusiveGroup)
          })
          continue
        }
      }
      items.push({ item: { kind: 'arg', arg }, score: scored.get(arg.name) ?? 0 })
    }
    if (q) items.sort((a, b) => b.score - a.score)
    result.set(
      category,
      items.map((i) => i.item)
    )
  }

  if (q) return result
  const activeItems: GroupItem[] = []
  for (const items of result.values()) {
    for (const item of items) {
      if (item.kind === 'exclusive') {
        if (item.group && activeInGroup(item.group) !== '') activeItems.push(item)
      } else if (item.arg && parsed.value.known.has(item.arg.name)) {
        activeItems.push(item)
      }
    }
  }
  if (activeItems.length === 0) return result
  const ordered = new Map<string, GroupItem[]>()
  ordered.set('active', activeItems)
  for (const [category, items] of result) ordered.set(category, items)
  return ordered
})

const hasResults = computed(() =>
  Array.from(structuredGroups.value.values()).some((items) => items.length > 0)
)

function onRawInput(value: string): void {
  localValue.value = value
}

function onRawChange(value: string): void {
  localValue.value = value
  emit('update', value)
}
</script>

<template>
  <div class="args-page flex min-w-0 flex-col gap-5 px-1 pt-1 pb-3">
    <header class="args-page-header flex flex-col items-start gap-2 pb-1">
      <Button
        variant="textonly"
        size="unset"
        type="button"
        class="args-page-back static inline-flex items-center gap-1.5 rounded-md border-none bg-transparent py-1.5 pr-2.5 pl-2 -ml-1 text-[13px] leading-[1.5] font-medium text-text-muted [font-family:inherit] whitespace-normal appearance-auto transition-[color,background-color,transform] duration-[120ms,120ms,80ms] ease-[ease] hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-text active:[transform:scale(0.97)] focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--action)] focus-visible:outline-offset-2 focus-visible:ring-0"
        :aria-label="t('common.back')"
        @click="emit('back')"
      >
        <ArrowLeft :size="16" />
        <span>{{ t('common.back') }}</span>
      </Button>
      <div class="args-page-title-row flex flex-wrap items-center gap-2">
        <h2
          class="args-page-title m-0 text-[18px] leading-[1.2] font-semibold tracking-[-0.01em] text-text"
        >
          {{ t('comfyUISettings.argsTitle') }}
        </h2>
        <span
          v-if="pendingRestart"
          class="args-page-restart-tag flex-none rounded-[9999px] border border-solid border-[color-mix(in_srgb,var(--warning)_36%,transparent)] bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] px-1.5 py-px text-[10px] leading-[14px] font-medium tracking-[0.02em] whitespace-nowrap text-[var(--warning)] uppercase"
          role="status"
        >
          {{ t('comfyUISettings.restartRequired') }}
        </span>
      </div>
    </header>

    <div
      class="args-page-raw flex flex-col gap-1.5 [&_.ui-input-control]:text-[13px] [&_.ui-input-control]:tracking-[-0.01em]"
    >
      <label class="args-page-raw-label text-[12px] font-medium text-text-muted">{{
        t('comfyUISettings.argsRawLabel')
      }}</label>
      <ArgsRawInput
        :model-value="localValue"
        :schema="schema"
        :placeholder="t('comfyUISettings.argsPlaceholder')"
        :aria-label="t('comfyUISettings.argsRawLabel')"
        @update:model-value="onRawInput"
        @change="onRawChange"
      />
      <p
        class="args-page-raw-hint mt-0.5 mr-0 mb-0 ml-0 text-[11px] leading-[1.4] text-[color-mix(in_srgb,var(--text-muted)_80%,transparent)]"
      >
        {{ t('comfyUISettings.argsRawHint') }}
      </p>
    </div>

    <BaseInput
      class="args-page-search [&_.ui-input-leading]:text-[color-mix(in_srgb,var(--text-muted)_75%,transparent)]"
      :class="searchClearClass"
      :model-value="search"
      :placeholder="t('comfyUISettings.argsSearchPlaceholder')"
      :aria-label="t('comfyUISettings.argsSearchPlaceholder')"
      @update:model-value="search = $event"
    >
      <template #leading>
        <Search :size="14" />
      </template>
      <template v-if="search.length > 0" #trailing>
        <InputGroupButton
          size="icon-sm"
          class="args-page-search-clear"
          :aria-label="t('common.clear')"
          @click="search = ''"
        >
          <X :size="14" />
        </InputGroupButton>
      </template>
    </BaseInput>

    <div
      v-if="loading"
      class="args-page-state flex flex-col items-center gap-2 px-4 py-6 text-center text-text-muted"
    >
      <Loader2
        :size="18"
        class="args-page-state-spinner animate-spin [animation-duration:900ms] motion-reduce:[animation-duration:2400ms]"
        aria-hidden="true"
      />
      <p class="args-page-state-text m-0 text-[13px] leading-[1.5]">
        {{ t('common.loading') }}
      </p>
    </div>
    <div
      v-else-if="loadError"
      class="args-page-state flex flex-col items-center gap-2 px-4 py-6 text-center args-page-state-error text-danger"
    >
      <AlertCircle :size="18" aria-hidden="true" />
      <p class="args-page-state-text m-0 text-[13px] leading-[1.5]">{{ loadError }}</p>
    </div>
    <div
      v-else-if="!hasResults"
      class="args-page-state flex flex-col items-center gap-2 px-4 py-6 text-center text-text-muted"
    >
      <SearchX :size="18" aria-hidden="true" />
      <p class="args-page-state-text m-0 text-[13px] leading-[1.5]">
        {{ t('comfyUISettings.argsNoMatches') }}
      </p>
    </div>

    <template v-else>
      <section
        v-for="[category, items] in structuredGroups"
        :key="category"
        class="args-page-category flex flex-col gap-1.5 [&+.args-page-category]:mt-3"
      >
        <header
          class="args-page-category-title mt-0 mr-0 mb-1 ml-0 text-[11px] font-semibold tracking-[0.08em] text-text-muted uppercase"
        >
          {{ categoryLabel(category) }}
        </header>

        <div
          v-for="(item, idx) in items"
          :key="idx"
          class="args-page-item flex min-w-0 flex-col [&+.args-page-item]:mt-0.5"
        >
          <template v-if="item.kind === 'exclusive' && item.args && item.group">
            <div class="args-page-cluster flex min-w-0 flex-col gap-1">
              <span
                class="args-page-cluster-label my-0.5 mx-0 px-0.5 text-[11px] font-medium tracking-[0.06em] text-text-muted uppercase"
              >
                {{ t('comfyUISettings.argsExclusiveLabel') }}:
                <span
                  class="args-page-cluster-options [font-family:ui-monospace,SFMono-Regular,Menlo,monospace] normal-case tracking-normal text-[color-mix(in_srgb,var(--text-muted)_85%,transparent)]"
                  >{{ clusterSummary(item.args) }}</span
                >
              </span>
              <BaseSelect
                :model-value="activeInGroup(item.group)"
                :options="clusterOptions(item.args)"
                :aria-label="`${t('comfyUISettings.argsExclusiveLabel')}: ${clusterSummary(item.args)}`"
                :placeholder="t('comfyUISettings.argsExclusiveNone')"
                @update:model-value="(v) => onExclusivePick(item.group!, v)"
              />
              <BaseInput
                v-if="activeValueDefInGroup(item.group)"
                class="args-page-value-input mt-2"
                :model-value="getValue(activeValueDefInGroup(item.group)!.name)"
                :placeholder="
                  activeValueDefInGroup(item.group)!.type === 'multi-value'
                    ? t('comfyUISettings.argsMultiPlaceholder')
                    : (activeValueDefInGroup(item.group)!.metavar ??
                      t('comfyUISettings.argsValuePlaceholder'))
                "
                @change="(v) => setValue(activeValueDefInGroup(item.group!)!, v)"
              />
              <p
                v-if="activeDefInGroup(item.group)?.help"
                class="args-page-cluster-help mt-1.5 mr-0 mb-0 ml-0 text-[12px] leading-[1.45] text-text-muted [overflow-wrap:anywhere]"
              >
                {{ activeDefInGroup(item.group)!.help }}
              </p>
            </div>
          </template>

          <template v-else-if="item.kind === 'arg' && item.arg">
            <div
              class="args-page-arg-row grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2.5 -mx-2.5 rounded-lg px-2.5 py-2 transition-[background-color] duration-[120ms] ease-[ease] hover:bg-[color-mix(in_srgb,var(--text)_4%,transparent)]"
            >
              <Button
                variant="textonly"
                size="unset"
                type="button"
                role="switch"
                class="args-page-switch relative mt-0.5 inline-block h-5 w-9 shrink-0 rounded-[999px] border-none p-0 cursor-pointer appearance-auto transition-[background-color] duration-200 ease-[ease] motion-reduce:duration-0 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--action)] focus-visible:outline-offset-2 focus-visible:ring-0"
                :class="
                  isActive(item.arg.name)
                    ? 'bg-[var(--accent-primary)] hover:bg-[var(--accent-primary)]'
                    : 'bg-[color-mix(in_srgb,var(--text-muted)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-muted)_40%,transparent)]'
                "
                :data-state="isActive(item.arg.name) ? 'checked' : 'unchecked'"
                :aria-checked="isActive(item.arg.name)"
                :aria-label="`--${item.arg.name}`"
                @click="toggleFlag(item.arg)"
              >
                <span
                  class="args-page-switch-thumb absolute top-0.5 left-0.5 size-4 rounded-[50%] transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:duration-0"
                  :class="
                    isActive(item.arg.name)
                      ? '[transform:translateX(16px)] bg-background shadow-none'
                      : '[transform:translateX(0)] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_1px_1px_rgba(0,0,0,0.08)]'
                  "
                  aria-hidden="true"
                ></span>
              </Button>
              <div class="args-page-arg-body flex min-w-0 flex-col gap-0.5">
                <span
                  class="args-page-flag [font:13px_ui-monospace,SFMono-Regular,Menlo,monospace] text-text [overflow-wrap:anywhere] [word-break:break-word]"
                  >--{{ item.arg.name }}</span
                >
                <p class="args-page-help m-0 text-[12px] leading-[1.45] text-text-muted">
                  {{ item.arg.help }}
                </p>
                <BaseInput
                  v-if="
                    isActive(item.arg.name) &&
                    (item.arg.type === 'value' ||
                      item.arg.type === 'optional-value' ||
                      item.arg.type === 'multi-value')
                  "
                  class="args-page-value-input mt-2"
                  :model-value="getValue(item.arg.name)"
                  :placeholder="
                    item.arg.type === 'multi-value'
                      ? t('comfyUISettings.argsMultiPlaceholder')
                      : (item.arg.metavar ??
                        (item.arg.type === 'optional-value'
                          ? t('comfyUISettings.argsOptionalPlaceholder')
                          : t('comfyUISettings.argsValuePlaceholder')))
                  "
                  @change="(v) => setValue(item.arg!, v)"
                />
              </div>
            </div>
          </template>
        </div>
      </section>
    </template>
  </div>
</template>
