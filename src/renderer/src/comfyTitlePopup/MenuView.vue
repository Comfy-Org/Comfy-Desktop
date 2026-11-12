<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from 'vue'
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

function activateFocused(elements: HTMLElement[]): boolean {
  const current = focusedIndex(elements)
  if (current < 0) return false
  const id = elements[current]?.dataset.id
  const item = props.items.find((entry) => entry.id === id)
  if (!item) return false
  handleClick(item)
  return true
}

function handleKeydown(event: KeyboardEvent): void {
  const elements = menuItems()
  if (elements.length === 0) return
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    moveFocus(event.key, elements)
    return
  }
  if ((event.key === 'Enter' || event.key === ' ') && activateFocused(elements)) {
    event.preventDefault()
  }
}

function clearFocus(): void {
  const active = document.activeElement
  if (active instanceof HTMLElement && menuEl.value?.contains(active)) active.blur()
}

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
        class="separator mx-1.5 my-1 h-px bg-border opacity-100"
        role="separator"
      />
      <li
        v-else
        class="item box-border flex h-8 cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-0 whitespace-nowrap transition-[background-color] duration-[80ms] ease-[ease] hover:bg-[oklch(1_0_0/0.07)] focus-visible:bg-[oklch(1_0_0/0.07)] focus-visible:outline-none"
        role="menuitem"
        :data-id="item.id"
        tabindex="-1"
        @click="handleClick(item)"
      >
        <span class="check inline-flex size-3.5 shrink-0 items-center justify-center opacity-85">
          <Check v-if="item.checked" :size="14" />
        </span>
        <span class="label flex-auto overflow-hidden text-ellipsis">{{ labelFor(item) }}</span>
      </li>
    </template>
  </ul>
</template>
