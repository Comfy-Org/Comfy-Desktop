<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'

// Custom select primitive: trigger + popover listbox, teleported to <body>
// so a drawer host's overflow:hidden can't clip it.

export interface BaseSelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

interface Props {
  modelValue: string
  options: BaseSelectOption[]
  ariaLabel?: string
  placeholder?: string
  loading?: boolean
  loadingLabel?: string
  disabled?: boolean
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  ariaLabel: undefined,
  placeholder: '',
  loading: false,
  loadingLabel: '',
  disabled: false,
  compact: false
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const triggerRef = ref<HTMLButtonElement | null>(null)
const listboxRef = ref<HTMLUListElement | null>(null)
const open = ref(false)
const activeIndex = ref(-1)
const popoverStyle = ref<Record<string, string>>({})

const selectedOption = computed(() => props.options.find((o) => o.value === props.modelValue))

const triggerLabel = computed(() =>
  props.loading && props.loadingLabel
    ? props.loadingLabel
    : (selectedOption.value?.label ?? props.placeholder)
)

const listboxId = `ui-listbox-${Math.random().toString(36).slice(2, 9)}`
const POPOVER_GAP = 2
const VIEWPORT_PADDING = 8
const ESTIMATED_OPTION_HEIGHT = 36
const ESTIMATED_LISTBOX_CHROME = 16
const PREFERRED_MAX_HEIGHT = 280

function updatePosition(): void {
  const trigger = triggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - POPOVER_GAP - VIEWPORT_PADDING)
  const spaceAbove = Math.max(0, rect.top - POPOVER_GAP - VIEWPORT_PADDING)
  const estimatedHeight = props.options.length * ESTIMATED_OPTION_HEIGHT + ESTIMATED_LISTBOX_CHROME
  const measuredHeight = listboxRef.value
    ? listboxRef.value.scrollHeight +
      Math.max(0, listboxRef.value.offsetHeight - listboxRef.value.clientHeight)
    : 0
  const desiredHeight = Math.min(measuredHeight || estimatedHeight, PREFERRED_MAX_HEIGHT)
  const openUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow
  const availableHeight = openUp ? spaceAbove : spaceBelow
  popoverStyle.value = {
    position: 'fixed',
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    top: openUp ? 'auto' : `${rect.bottom + POPOVER_GAP}px`,
    bottom: openUp ? `${window.innerHeight - rect.top + POPOVER_GAP}px` : 'auto',
    maxHeight: `${availableHeight}px`,
    zIndex: '9999'
  }
}

function openPanel(): void {
  if (open.value || props.disabled) return
  open.value = true
  const idx = props.options.findIndex((o) => o.value === props.modelValue && !o.disabled)
  activeIndex.value = idx >= 0 ? idx : props.options.findIndex((o) => !o.disabled)
  updatePosition()
  void nextTick(() => {
    // The rendered list may be taller than the per-option estimate.
    updatePosition()
    listboxRef.value?.focus()
    scrollActiveIntoView()
  })
}

function closePanel(returnFocus = true): void {
  if (!open.value) return
  open.value = false
  if (returnFocus) {
    void nextTick(() => triggerRef.value?.focus())
  }
}

function toggle(): void {
  if (open.value) closePanel()
  else openPanel()
}

function selectIndex(i: number): void {
  const opt = props.options[i]
  if (!opt || opt.disabled) return
  emit('update:modelValue', opt.value)
  closePanel()
}

function moveActive(delta: number): void {
  const len = props.options.length
  if (len === 0) return
  let i = activeIndex.value
  for (let step = 0; step < len; step++) {
    i = (i + delta + len) % len
    if (!props.options[i]?.disabled) {
      activeIndex.value = i
      scrollActiveIntoView()
      return
    }
  }
}

function scrollActiveIntoView(): void {
  const list = listboxRef.value
  if (!list) return
  const el = list.querySelector<HTMLElement>(`[data-index="${activeIndex.value}"]`)
  el?.scrollIntoView({ block: 'nearest' })
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (
    event.key === 'ArrowDown' ||
    event.key === 'ArrowUp' ||
    event.key === 'Enter' ||
    event.key === ' '
  ) {
    event.preventDefault()
    openPanel()
  }
}

function onListboxKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      moveActive(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      moveActive(-1)
      break
    case 'Home':
      event.preventDefault()
      activeIndex.value = props.options.findIndex((o) => !o.disabled)
      scrollActiveIntoView()
      break
    case 'End':
      event.preventDefault()
      for (let i = props.options.length - 1; i >= 0; i--) {
        if (!props.options[i]?.disabled) {
          activeIndex.value = i
          scrollActiveIntoView()
          break
        }
      }
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      if (activeIndex.value >= 0) selectIndex(activeIndex.value)
      break
    case 'Escape':
      event.preventDefault()
      closePanel()
      break
    case 'Tab':
      closePanel(false)
      break
  }
}

function onDocPointer(event: PointerEvent): void {
  if (!open.value) return
  const t = event.target as Node | null
  if (t && !triggerRef.value?.contains(t) && !listboxRef.value?.contains(t)) {
    closePanel(false)
  }
}

function onWindowChange(): void {
  if (open.value) updatePosition()
}

function onWindowBlur(): void {
  // Close on focus loss to another window (e.g. clicking out of the IPP).
  // The document `pointerdown` listener doesn't catch that because the
  // click lands in a different WebContents — the dropdown would otherwise
  // stay open and resurface when the user returns.
  if (open.value) closePanel(false)
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('pointerdown', onDocPointer, true)
    window.addEventListener('resize', onWindowChange)
    window.addEventListener('scroll', onWindowChange, true)
    window.addEventListener('blur', onWindowBlur)
  } else {
    document.removeEventListener('pointerdown', onDocPointer, true)
    window.removeEventListener('resize', onWindowChange)
    window.removeEventListener('scroll', onWindowChange, true)
    window.removeEventListener('blur', onWindowBlur)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  window.removeEventListener('resize', onWindowChange)
  window.removeEventListener('scroll', onWindowChange, true)
})
</script>

<template>
  <button
    ref="triggerRef"
    type="button"
    class="ui-select-trigger box-border inline-flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-solid border-border bg-secondary px-2.5 py-2 text-left text-[length:var(--text-ui)] text-text transition-[border-color,background-color] duration-[150ms] ease-[ease] enabled:hover:border-[var(--color-border-strong)] enabled:hover:bg-[oklch(1_0_0/0.09)] focus-visible:border-ring focus-visible:outline-none aria-expanded:border-ring disabled:cursor-not-allowed disabled:opacity-60"
    :class="{ 'ui-select-trigger--compact': compact }"
    role="combobox"
    :aria-expanded="open"
    :aria-controls="listboxId"
    aria-haspopup="listbox"
    :aria-label="ariaLabel"
    :aria-busy="loading || undefined"
    :data-placeholder="!selectedOption && !loading ? '' : undefined"
    :disabled="disabled"
    @click="toggle"
    @keydown="onTriggerKeydown"
  >
    <span
      class="ui-select-label min-w-0 flex-1 truncate"
      :class="{ 'text-text-muted': !selectedOption && !loading }"
      >{{ triggerLabel }}</span
    >
    <ChevronDown
      :size="14"
      class="ui-select-chevron shrink-0 text-text-muted transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] data-[open]:rotate-180 motion-reduce:duration-0"
      :data-open="open ? '' : undefined"
    />
  </button>

  <Teleport to="body">
    <Transition
      name="ui-select-pop"
      enter-active-class="transition-[opacity,transform] duration-[150ms] ease-out motion-reduce:duration-0"
      leave-active-class="transition-[opacity,transform] duration-[150ms] ease-out motion-reduce:duration-0"
      enter-from-class="opacity-0 [transform:translateY(-4px)]"
      leave-to-class="opacity-0 [transform:translateY(-4px)]"
    >
      <ul
        v-if="open"
        :id="listboxId"
        ref="listboxRef"
        class="ui-select-listbox box-border m-0 list-none overflow-y-auto rounded-card border border-solid border-border bg-popover p-1 shadow-popover outline-none"
        :class="{ 'ui-select-listbox--compact': compact }"
        role="listbox"
        tabindex="-1"
        :style="popoverStyle"
        :aria-label="ariaLabel"
        @keydown="onListboxKeydown"
      >
        <li
          v-for="(opt, i) in options"
          :key="opt.value"
          class="ui-select-option flex cursor-pointer items-center gap-2 rounded-control text-text select-none data-[active]:bg-[oklch(1_0_0/0.07)] data-[selected]:bg-[oklch(1_0_0/0.07)] aria-disabled:cursor-not-allowed aria-disabled:text-text-muted"
          :class="
            compact
              ? 'px-2 py-1.5 text-[length:var(--takeover-fs-caption)]'
              : 'px-2.5 py-2 text-[14px]'
          "
          role="option"
          :data-index="i"
          :data-active="i === activeIndex ? '' : undefined"
          :data-selected="opt.value === modelValue ? '' : undefined"
          :aria-selected="opt.value === modelValue"
          :aria-disabled="opt.disabled || undefined"
          @mousemove="activeIndex = i"
          @click="selectIndex(i)"
        >
          <span class="ui-select-option-body flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="ui-select-option-label truncate">{{ opt.label }}</span>
            <span
              v-if="opt.description"
              class="ui-select-option-desc text-[length:var(--takeover-fs-caption)] whitespace-normal text-text-muted [overflow-wrap:break-word]"
              >{{ opt.description }}</span
            >
          </span>
          <Check
            v-if="opt.value === modelValue"
            :size="14"
            class="ui-select-option-check shrink-0 text-[var(--accent-primary)]"
          />
        </li>
      </ul>
    </Transition>
  </Teleport>
</template>
