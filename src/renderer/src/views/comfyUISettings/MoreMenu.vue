<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useTemplateRef,
  watch,
  type Component
} from 'vue'
import { TID } from '../../../../shared/testIds'
import type { ActionDef } from '../../types/ipc'

/**
 * Footer dropdown for the Settings drawer. Renders either the `pinBottom`
 * install-level actions ("More") or the navigation alternatives off the CTA
 * caret. Clicking an item emits `'pick'`; the parent runs it. Keyboard-navigable,
 * ESC / click-outside dismiss. An optional `heading` + per-item `icon` give the
 * caret variant a titled, icon-aligned look; the plain "More" menu passes
 * neither and renders unchanged.
 */

/** `ActionDef` plus an optional leading icon component (caret variant only). */
export type MenuAction = ActionDef & { icon?: Component }

interface Props {
  open: boolean
  actions: MenuAction[]
  /** Optional section title shown above a divider (caret variant). */
  heading?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  pick: [action: MenuAction]
}>()

const menuRef = useTemplateRef<HTMLElement>('menu')
const focusedIndex = ref(0)

// Reset focus to the first item every time the menu opens.
watch(
  () => props.open,
  async (next) => {
    if (!next) return
    focusedIndex.value = 0
    await nextTick()
    menuRef.value?.querySelectorAll<HTMLButtonElement>('.more-menu-item')[0]?.focus()
  }
)

function handlePick(action: MenuAction): void {
  if (action.enabled === false) return
  emit('pick', action)
  emit('close')
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const total = props.actions.length
  if (total === 0) return
  const delta = event.key === 'ArrowDown' ? 1 : -1
  focusedIndex.value = (focusedIndex.value + delta + total) % total
  nextTick(() => {
    menuRef.value
      ?.querySelectorAll<HTMLButtonElement>('.more-menu-item')
      [focusedIndex.value]?.focus()
  })
}

// Click-outside dismiss. The trigger toggles `open` itself, so we skip clicks on it via the `data-more-trigger` attr (avoids threading a ref).
function handleDocumentClick(event: MouseEvent): void {
  if (!props.open) return
  const target = event.target as Node | null
  if (menuRef.value?.contains(target)) return
  const trigger = (event.target as HTMLElement | null)?.closest('[data-more-trigger]')
  if (trigger) return
  emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('mousedown', handleDocumentClick)
})
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('mousedown', handleDocumentClick)
})

const visibleActions = computed(() => props.actions)
// Reserve the icon column when ANY item has an icon, so labels stay aligned
// whether or not a given row carries one.
const hasIcons = computed(() => props.actions.some((a) => !!a.icon))
</script>

<template>
  <Transition
    name="more-menu-fade"
    enter-active-class="more-menu-fade-enter-active [transition:opacity_120ms_ease,transform_120ms_cubic-bezier(0.32,0.72,0,1)]"
    leave-active-class="more-menu-fade-leave-active [transition:opacity_120ms_ease,transform_120ms_cubic-bezier(0.32,0.72,0,1)]"
    enter-from-class="more-menu-fade-enter-from opacity-0 [transform:translateY(4px)]"
    leave-to-class="more-menu-fade-leave-to opacity-0 [transform:translateY(4px)]"
  >
    <ul
      v-if="open && visibleActions.length > 0"
      ref="menu"
      class="more-menu absolute right-0 bottom-[calc(100%+6px)] z-62 m-0 list-none rounded-[10px] border border-solid border-[var(--chooser-surface-border)] bg-[var(--modal-surface-bg)] p-1.5 shadow-[var(--modal-surface-shadow)]"
      :class="[
        { 'has-heading': !!heading, 'has-icons': hasIcons },
        heading || hasIcons ? 'w-max min-w-[168px] max-w-[280px]' : 'min-w-[200px]'
      ]"
      role="menu"
      :aria-label="heading"
      aria-orientation="vertical"
    >
      <li
        v-if="heading"
        class="more-menu-heading mb-1 border-b border-solid border-[var(--chooser-surface-border)] px-3 pt-1 pb-1.5 text-[11px] font-semibold tracking-[0.04em] text-text-muted uppercase opacity-70"
        role="presentation"
      >
        {{ heading }}
      </li>
      <li v-for="(action, i) in visibleActions" :key="action.id" role="none">
        <button
          type="button"
          role="menuitem"
          class="more-menu-item group/more flex w-full items-center gap-[9px] rounded-md border-none bg-transparent px-3.5 py-2 text-left text-[13px] transition-[background-color,color] duration-100 ease-[ease] enabled:hover:bg-[var(--brand-surface-bg-hover)] focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          :class="[
            { 'is-disabled': action.enabled === false },
            action.style === 'danger'
              ? 'is-danger text-danger enabled:hover:text-danger-hover focus-visible:text-danger-hover'
              : action.style === 'accent'
                ? 'is-accent text-[var(--accent-primary)] enabled:hover:text-text'
                : 'text-neutral-100 enabled:hover:text-text focus-visible:text-text'
          ]"
          :disabled="action.enabled === false"
          :tabindex="focusedIndex === i ? 0 : -1"
          :data-testid="TID.pinBottomAction(action.id)"
          @click="handlePick(action)"
        >
          <span
            v-if="hasIcons"
            class="more-menu-item-icon inline-flex size-4 flex-[0_0_16px] items-center justify-center text-text-muted group-[:enabled:hover]/more:text-inherit group-focus-visible/more:text-inherit"
            aria-hidden="true"
          >
            <component :is="action.icon" v-if="action.icon" :size="15" />
          </span>
          <span class="more-menu-item-label flex-auto">{{ action.label }}</span>
        </button>
      </li>
    </ul>
  </Transition>
</template>
