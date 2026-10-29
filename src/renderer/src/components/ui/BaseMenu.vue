<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'

// Actions-menu primitive: a trigger and a popover list of items that fire
// `select` on pick. Auto-flips up/down by available space and teleports the
// popover to <body> so ancestor `overflow:hidden` can't clip it.

export interface BaseMenuItem {
  id: string
  label: string
  disabled?: boolean
  style?: 'default' | 'danger'
  /** Draws a divider above this item. */
  separator?: boolean
  /** Secondary text after the label; wraps where the label does not. */
  detail?: string
}

interface Props {
  items: BaseMenuItem[]
  triggerAriaLabel?: string
  /** Min popover width so labels don't reflow on open. */
  minWidth?: number
  /** `start` aligns the menu's left edge with the trigger's; `end` aligns
   *  the right edges, tucking trailing-side menus back into the viewport. */
  align?: 'start' | 'end'
  offset?: number
  /** Non-interactive caption above the items. */
  heading?: string
  /** Class on the teleported list, which scoped consumer styles cannot reach. */
  listClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  triggerAriaLabel: undefined,
  minWidth: undefined,
  heading: undefined,
  listClass: undefined,
  align: 'start',
  offset: 4
})

const emit = defineEmits<{
  select: [id: string]
}>()

const triggerRef = useTemplateRef<HTMLButtonElement>('trigger')
const menuRef = useTemplateRef<HTMLUListElement>('menu')
const open = ref(false)
const activeIndex = ref(-1)
const popoverStyle = ref<Record<string, string>>({})

const menuId = `ui-menu-${Math.random().toString(36).slice(2, 9)}`

function firstEnabledIndex(): number {
  return props.items.findIndex((i) => !i.disabled)
}

const VIEWPORT_PAD_PX = 4

// Picks a side by available space, anchors x by `align`, and clamps into
// the viewport. Called once with an estimated rect, then again post-mount
// with the measured rect (needed so long labels stop clipping).
function updatePosition(): void {
  const trigger = triggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  const measured = menuRef.value?.getBoundingClientRect() ?? null
  const minWidth = props.minWidth ?? rect.width
  const menuWidth = Math.max(measured?.width ?? 0, minWidth)
  const estimatedHeight = Math.min(props.items.length * 36 + 16, 320)
  const menuHeight = measured?.height ?? estimatedHeight

  const spaceBelow = vh - rect.bottom - props.offset
  const spaceAbove = rect.top - props.offset
  const openUp = menuHeight + VIEWPORT_PAD_PX > spaceBelow && spaceAbove > spaceBelow
  const top = openUp ? rect.top - props.offset - menuHeight : rect.bottom + props.offset

  const anchorLeft = props.align === 'end' ? rect.right - menuWidth : rect.left
  const clampedLeft = Math.min(
    Math.max(anchorLeft, VIEWPORT_PAD_PX),
    Math.max(VIEWPORT_PAD_PX, vw - menuWidth - VIEWPORT_PAD_PX)
  )

  popoverStyle.value = {
    position: 'fixed',
    left: `${clampedLeft}px`,
    top: `${Math.max(VIEWPORT_PAD_PX, Math.min(top, vh - menuHeight - VIEWPORT_PAD_PX))}px`,
    minWidth: `${minWidth}px`,
    maxWidth: `${vw - VIEWPORT_PAD_PX * 2}px`,
    maxHeight: `${(openUp ? spaceAbove : spaceBelow) - VIEWPORT_PAD_PX}px`,
    zIndex: '9999'
  }
}

function openPanel(): void {
  if (open.value) return
  if (props.items.length === 0) return
  open.value = true
  activeIndex.value = firstEnabledIndex()
  // First pass avoids a flash at (0,0); second re-measures the real rect.
  updatePosition()
  void nextTick(() => {
    updatePosition()
    menuRef.value?.focus()
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

function pickIndex(i: number): void {
  const item = props.items[i]
  if (!item || item.disabled) return
  emit('select', item.id)
  closePanel()
}

function moveActive(delta: number): void {
  const len = props.items.length
  if (len === 0) return
  let i = activeIndex.value
  for (let step = 0; step < len; step++) {
    i = (i + delta + len) % len
    if (!props.items[i]?.disabled) {
      activeIndex.value = i
      scrollActiveIntoView()
      return
    }
  }
}

function scrollActiveIntoView(): void {
  const list = menuRef.value
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

function onMenuKeydown(event: KeyboardEvent): void {
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
      activeIndex.value = firstEnabledIndex()
      scrollActiveIntoView()
      break
    case 'End':
      event.preventDefault()
      for (let i = props.items.length - 1; i >= 0; i--) {
        if (!props.items[i]?.disabled) {
          activeIndex.value = i
          scrollActiveIntoView()
          break
        }
      }
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      if (activeIndex.value >= 0) pickIndex(activeIndex.value)
      break
    case 'Escape':
      event.preventDefault()
      // Keep a host popup, which listens on window, from closing too.
      event.stopPropagation()
      closePanel()
      break
    case 'Tab':
      closePanel(false)
      break
  }
}

function onDocPointer(event: PointerEvent): void {
  if (!open.value) return
  const target = event.target as Node | null
  if (target && !triggerRef.value?.contains(target) && !menuRef.value?.contains(target)) {
    closePanel(false)
  }
}

function onWindowChange(): void {
  if (open.value) updatePosition()
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('pointerdown', onDocPointer, true)
    window.addEventListener('resize', onWindowChange)
    window.addEventListener('scroll', onWindowChange, true)
  } else {
    document.removeEventListener('pointerdown', onDocPointer, true)
    window.removeEventListener('resize', onWindowChange)
    window.removeEventListener('scroll', onWindowChange, true)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  window.removeEventListener('resize', onWindowChange)
  window.removeEventListener('scroll', onWindowChange, true)
})

defineExpose({ open: openPanel, close: closePanel, toggle })
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="ui-menu-trigger inline-flex h-8 items-center gap-2 rounded-lg border-none bg-[var(--pick-bg-active,color-mix(in_srgb,var(--text)_10%,transparent))] py-2 pr-2 pl-4 text-[12px] leading-4 font-medium text-neutral-100 cursor-pointer transition-[background-color] duration-[120ms] ease-[ease] hover:bg-[var(--pick-bg-hover,color-mix(in_srgb,var(--text)_14%,transparent))] hover:outline-none focus-visible:bg-[var(--pick-bg-hover,color-mix(in_srgb,var(--text)_14%,transparent))] focus-visible:outline-none aria-expanded:bg-[var(--pick-bg-hover,color-mix(in_srgb,var(--text)_14%,transparent))]"
    :aria-expanded="open"
    :aria-controls="menuId"
    aria-haspopup="menu"
    :aria-label="triggerAriaLabel"
    @click="toggle"
    @keydown="onTriggerKeydown"
  >
    <slot />
  </button>

  <Teleport to="body">
    <Transition
      name="ui-menu-pop"
      enter-active-class="ui-menu-pop-enter-active transition-[opacity,transform] duration-150 ease-[ease-out] motion-reduce:duration-0"
      leave-active-class="ui-menu-pop-leave-active transition-[opacity,transform] duration-150 ease-[ease-out] motion-reduce:duration-0"
      enter-from-class="ui-menu-pop-enter-from opacity-0 [transform:translateY(-4px)]"
      leave-to-class="ui-menu-pop-leave-to opacity-0 [transform:translateY(-4px)]"
    >
      <ul
        v-if="open"
        :id="menuId"
        ref="menu"
        :class="[
          'ui-menu-list m-0 min-w-[200px] list-none overflow-y-auto rounded-[10px] border border-solid border-[var(--border)] bg-surface p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.28),0_2px_6px_rgba(0,0,0,0.18)] outline-none',
          listClass
        ]"
        role="menu"
        tabindex="-1"
        :style="popoverStyle"
        :aria-label="triggerAriaLabel"
        @keydown="onMenuKeydown"
      >
        <li
          v-if="heading"
          class="ui-menu-heading px-3.5 pt-1.5 pb-1 text-[11px] tracking-[0.04em] text-text-muted uppercase"
          role="presentation"
        >
          {{ heading }}
        </li>
        <template v-for="(item, i) in items" :key="item.id">
          <li
            v-if="item.separator && i > 0"
            class="ui-menu-separator pointer-events-none mx-1.5 my-1 h-px list-none bg-[var(--border)]"
            role="separator"
          />
          <li
            class="ui-menu-item flex items-center gap-2.5 rounded-md px-3.5 py-2 text-[14px] whitespace-nowrap select-none"
            :class="[
              item.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
              item.style === 'danger' && i === activeIndex
                ? 'text-danger-hover bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]'
                : [
                    item.disabled
                      ? 'text-text-muted'
                      : item.style === 'danger'
                        ? 'text-danger'
                        : 'text-text',
                    i === activeIndex ? 'bg-border-hover' : ''
                  ]
            ]"
            role="menuitem"
            :data-index="i"
            :data-active="i === activeIndex ? '' : undefined"
            :data-danger="item.style === 'danger' ? '' : undefined"
            :aria-disabled="item.disabled || undefined"
            @mousemove="activeIndex = i"
            @click="pickIndex(i)"
          >
            <span class="ui-menu-item-label">{{ item.label }}</span>
            <span
              v-if="item.detail"
              class="ui-menu-item-detail min-w-0 whitespace-normal text-text-muted [overflow-wrap:anywhere]"
              >{{ item.detail }}</span
            >
          </li>
        </template>
      </ul>
    </Transition>
  </Teleport>
</template>
