<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef, watch } from 'vue'
import { Check } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

interface MenuItem {
  id?: string
  label?: string
  labelKey?: string
  checked?: boolean
  kind?: 'separator'
}

const props = defineProps<{
  items: MenuItem[]
}>()

const emit = defineEmits<{
  (e: 'activate', id: string): void
}>()

const { t } = useI18n()

function labelFor(item: MenuItem): string {
  if (item.labelKey) return t(item.labelKey, item.label ?? '')
  return item.label ?? ''
}

function handleClick(item: MenuItem): void {
  if (item.kind === 'separator') return
  if (!item.id) return
  emit('activate', item.id)
}

const menuEl = useTemplateRef<HTMLUListElement>('menu')

function menuItems(): HTMLElement[] {
  return Array.from(menuEl.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
}

function focusedIndex(elements: HTMLElement[]): number {
  return elements.findIndex((el) => el === document.activeElement)
}

function moveFocus(key: string, elements: HTMLElement[]): void {
  const current = focusedIndex(elements)
  const last = elements.length - 1
  let next: number
  if (key === 'Home') next = 0
  else if (key === 'End') next = last
  else if (key === 'ArrowDown') next = current < 0 || current === last ? 0 : current + 1
  else next = current <= 0 ? last : current - 1
  elements[next]?.focus()
}

function activateFocused(elements: HTMLElement[], repeat: boolean): boolean {
  const current = focusedIndex(elements)
  if (current < 0) return false
  const item = props.items[Number(elements[current]?.dataset.index)]
  if (!item?.id) return false
  if (!repeat) handleClick(item)
  return true
}

function focusIsElsewhere(): boolean {
  const active = document.activeElement
  if (!active || active === document.body) return false
  return !menuEl.value?.contains(active)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || focusIsElsewhere()) return
  const elements = menuItems()
  if (elements.length === 0) return
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    moveFocus(event.key, elements)
    return
  }
  if ((event.key === 'Enter' || event.key === ' ') && activateFocused(elements, event.repeat)) {
    event.preventDefault()
  }
}

function clearFocus(): void {
  const active = document.activeElement
  if (active instanceof HTMLElement && menuEl.value?.contains(active)) active.blur()
}

watch(() => props.items, clearFocus)

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('blur', clearFocus)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('blur', clearFocus)
})
</script>

<template>
  <ul ref="menu" class="menu m-0 list-none p-1" role="menu">
    <template v-for="(item, idx) in items" :key="idx">
      <li
        v-if="item.kind === 'separator'"
        class="separator mx-1 my-1 h-px bg-border opacity-100"
        role="separator"
      />
      <li
        v-else
        class="item box-border flex h-8 cursor-pointer items-center gap-2 rounded-md px-3 py-0 whitespace-nowrap transition-[background-color] duration-[80ms] ease-[ease] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
        :role="item.id ? 'menuitem' : 'none'"
        :data-index="idx"
        :tabindex="item.id ? -1 : undefined"
        @click="handleClick(item)"
      >
        <span class="label flex-auto overflow-hidden text-ellipsis">{{ labelFor(item) }}</span>
        <Check v-if="item.checked" class="check shrink-0" :size="15" aria-hidden="true" />
      </li>
    </template>
  </ul>
</template>
