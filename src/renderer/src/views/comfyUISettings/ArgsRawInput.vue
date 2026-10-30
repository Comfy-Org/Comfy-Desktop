<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle } from 'lucide-vue-next'
import BaseInput from '../../components/ui/BaseInput.vue'
import { useArgsAutocomplete } from '../../composables/useArgsAutocomplete'
import { validateArgs } from '../../lib/argsParser'
import type { ComfyArgDef } from '../../types/ipc'

/**
 * Raw startup-arguments text input with inline flag autocomplete and inline
 * validation (colored token echo + per-issue messages + red invalid border).
 * Shared by the compact settings field and the full args sub-page, so the
 * correctness check shows wherever the raw field appears.
 */

const props = withDefaults(
  defineProps<{
    modelValue: string
    schema: ComfyArgDef[]
    placeholder?: string
    ariaLabel?: string
  }>(),
  {
    placeholder: '',
    ariaLabel: undefined
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const { t } = useI18n()

const localValue = ref(props.modelValue)
watch(
  () => props.modelValue,
  (next) => {
    if (next !== localValue.value) localValue.value = next
  }
)

const focused = ref(false)

const autocomplete = useArgsAutocomplete({
  value: localValue,
  schema: toRef(props, 'schema'),
  focused,
  onAccept(next) {
    localValue.value = next
    emit('update:modelValue', next)
    emit('change', next)
  }
})

// Inline validation: colored tokens + per-issue messages so unsupported flags,
// missing values, and stray positionals are visible instead of silently
// surviving. The trailing flag being typed is held off while focused.
const validation = computed(() =>
  props.schema.length
    ? validateArgs(localValue.value, props.schema, { suppressTrailingPartial: focused.value })
    : null
)
const hasIssues = computed(() => validation.value?.hasIssues ?? false)
const showTokenDisplay = computed(() => hasIssues.value || validation.value?.awaiting != null)

function handleInput(value: string): void {
  localValue.value = value
  emit('update:modelValue', value)
}

function handleChange(value: string): void {
  emit('change', value)
}

// The wrapper also hosts the trailing slot's buttons (gear, beta-args pill). Only the text
// input drives autocomplete: Enter on one of those buttons must press it, not complete a
// partially typed flag and persist the rewritten args.
function fromTextInput(e: Event): boolean {
  return e.target instanceof HTMLInputElement
}
function onFocus(e: FocusEvent): void {
  if (fromTextInput(e)) focused.value = true
}
function onBlur(): void {
  focused.value = false
}
function onKeydown(e: KeyboardEvent): void {
  if (!fromTextInput(e)) return
  if (autocomplete.handleKeydown(e.key) === 'consumed') e.preventDefault()
}
</script>

<template>
  <div class="args-raw-input relative" @focusin="onFocus" @focusout="onBlur" @keydown="onKeydown">
    <BaseInput
      mono
      :spellcheck="false"
      :model-value="localValue"
      :placeholder="placeholder || t('comfyUISettings.argsPlaceholder', 'No arguments set')"
      :aria-label="ariaLabel"
      :invalid="hasIssues"
      @update:model-value="handleInput"
      @change="handleChange"
    >
      <template v-if="$slots.trailing" #trailing>
        <slot name="trailing" />
      </template>
    </BaseInput>
    <ul
      v-if="autocomplete.visible.value"
      class="args-raw-input-ac absolute top-[calc(100%+4px)] right-0 left-0 z-50 m-0 max-h-[280px] list-none overflow-y-auto rounded-lg border border-solid border-[var(--border)] bg-surface p-1 shadow-[0_8px_24px_rgba(0,0,0,0.32)]"
      role="listbox"
      :aria-label="t('comfyUISettings.argsAutocompleteLabel', 'Argument suggestions')"
    >
      <li
        v-for="(m, i) in autocomplete.matches.value"
        :key="m.name"
        class="args-raw-input-ac-item flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-[12px] text-text transition-[background-color] duration-[120ms] ease-[ease] hover:bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)]"
        :class="{
          'selected bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)]':
            i === autocomplete.acIndex.value
        }"
        role="option"
        :aria-selected="i === autocomplete.acIndex.value"
        @mousedown.prevent="autocomplete.completeArg(m.name)"
        @mouseenter="autocomplete.acIndex.value = i"
      >
        <span
          class="args-raw-input-ac-flag shrink-0 font-[family-name:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)] font-semibold text-[var(--accent-primary)]"
          >{{ m.flag }}</span
        >
        <span
          v-if="m.type !== 'boolean'"
          class="args-raw-input-ac-meta shrink-0 font-[family-name:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)] text-[11px] text-text-muted"
        >
          {{ m.metavar ? (m.type === 'optional-value' ? `[${m.metavar}]` : m.metavar) : '' }}
        </span>
        <span class="args-raw-input-ac-help min-w-0 flex-1 truncate text-text-muted">{{
          m.help
        }}</span>
      </li>
      <li
        class="args-raw-input-ac-hint mt-0.5 cursor-default border-t border-solid border-[var(--border)] px-2 pt-1 pb-0.5 text-right text-[10px] text-[color:color-mix(in_srgb,var(--text-muted)_70%,transparent)]"
        aria-hidden="true"
      >
        {{
          t('comfyUISettings.argsAutocompleteHint', '↑↓ navigate · Tab/Enter select · Esc dismiss')
        }}
      </li>
    </ul>

    <!-- Colored echo of the raw string so problem tokens are easy to spot. -->
    <div
      v-if="validation && showTokenDisplay && validation.tokens.length"
      class="args-raw-tokens mt-1.5 flex flex-wrap gap-x-1.5 gap-y-1 rounded-md border border-solid border-[var(--chooser-surface-border)] bg-neutral-800 px-2.5 py-1.5 font-[family-name:ui-monospace,SFMono-Regular,Menlo,monospace] text-[12px] leading-[1.5] text-text-muted"
      aria-hidden="true"
    >
      <span
        v-for="(tok, i) in validation.tokens"
        :key="i"
        :class="{
          'token-bad text-danger underline decoration-wavy underline-offset-[3px]':
            tok.status === 'unsupported' || tok.status === 'orphaned',
          'token-missing text-[var(--warning)] underline decoration-wavy underline-offset-[3px]':
            tok.status === 'missing-value',
          'token-awaiting text-[var(--accent-primary)] underline decoration-dotted underline-offset-[3px]':
            tok.status === 'awaiting-value',
          'token-partial text-text-muted opacity-60': tok.status === 'partial'
        }"
        :title="tok.tooltip || ''"
        >{{ tok.text }}</span
      >
    </div>

    <template v-if="validation">
      <p
        v-if="validation.awaiting"
        class="args-raw-validation args-raw-validation-info mt-1.5 flex flex-wrap items-start gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] leading-[1.5] [&_svg]:mt-0.5 [&_svg]:shrink-0 text-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)]"
        role="status"
      >
        <AlertCircle :size="12" aria-hidden="true" />
        <span>
          {{ validation.awaiting.text }}
          {{ t('comfyUISettings.argsAwaitingValue', 'expects a value') }}
        </span>
      </p>
      <p
        v-if="validation.unsupportedFlags.length > 0"
        class="args-raw-validation args-raw-validation-error mt-1.5 flex flex-wrap items-start gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] leading-[1.5] [&_svg]:mt-0.5 [&_svg]:shrink-0 text-danger bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
        role="status"
      >
        <AlertCircle :size="12" aria-hidden="true" />
        <span>
          {{ t('comfyUISettings.argsUnsupported', 'Unsupported:') }}
          <code
            v-for="flag in validation.unsupportedFlags"
            :key="flag"
            class="args-raw-bad-flag rounded-[3px] bg-[color-mix(in_srgb,currentcolor_14%,transparent)] px-1 font-[family-name:ui-monospace,SFMono-Regular,Menlo,monospace] text-[11px]"
            >--{{ flag }}</code
          >
        </span>
      </p>
      <p
        v-if="validation.missingValueFlags.length > 0"
        class="args-raw-validation args-raw-validation-warn mt-1.5 flex flex-wrap items-start gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] leading-[1.5] [&_svg]:mt-0.5 [&_svg]:shrink-0 text-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_14%,transparent)]"
        role="status"
      >
        <AlertCircle :size="12" aria-hidden="true" />
        <span>
          {{ t('comfyUISettings.argsMissingValue', 'Missing value for:') }}
          <code
            v-for="flag in validation.missingValueFlags"
            :key="flag"
            class="args-raw-bad-flag rounded-[3px] bg-[color-mix(in_srgb,currentcolor_14%,transparent)] px-1 font-[family-name:ui-monospace,SFMono-Regular,Menlo,monospace] text-[11px]"
            >{{ flag }}</code
          >
        </span>
      </p>
      <p
        v-if="validation.orphanedTokens.length > 0"
        class="args-raw-validation args-raw-validation-error mt-1.5 flex flex-wrap items-start gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] leading-[1.5] [&_svg]:mt-0.5 [&_svg]:shrink-0 text-danger bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
        role="status"
      >
        <AlertCircle :size="12" aria-hidden="true" />
        <span>
          {{ t('comfyUISettings.argsUnexpected', 'Unexpected:') }}
          <code
            v-for="tok in validation.orphanedTokens"
            :key="tok"
            class="args-raw-bad-flag rounded-[3px] bg-[color-mix(in_srgb,currentcolor_14%,transparent)] px-1 font-[family-name:ui-monospace,SFMono-Regular,Menlo,monospace] text-[11px]"
            >{{ tok }}</code
          >
        </span>
      </p>
    </template>
  </div>
</template>
