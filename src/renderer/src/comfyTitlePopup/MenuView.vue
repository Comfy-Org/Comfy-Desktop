<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, useTemplateRef, watch } from 'vue'
import type { Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow, ChartColumn, Gauge, LoaderCircle } from '@lucide/vue'
import type { TitlePopupMenuIcon, TitlePopupMenuItem as MenuItem } from '../../../types/ipc'

const MENU_ICONS: Record<TitlePopupMenuIcon, Component> = {
  'performance-test': Gauge,
  benchmarks: ChartColumn
}

const props = defineProps<{
  items: MenuItem[]
}>()

const emit = defineEmits<{
  (e: 'activate', id: string): void
}>()

const { t } = useI18n()

const hasIcons = computed(() => props.items.some((item) => item.icon || item.app))

const brokenPictures = reactive(new Set<string>())

function pictureOf(item: MenuItem): string | null {
  if (!item.app?.picture || brokenPictures.has(item.app.picture)) return null
  return item.app.picture
}

function appLabelOf(item: MenuItem): string | undefined {
  if (!item.app) return undefined
  const key = item.app.state === 'running' ? 'apps.rail.running' : 'apps.rail.finished'
  return t(key, { app: labelFor(item) })
}

function labelFor(item: MenuItem): string {
  if (!item.labelKey) return item.label ?? ''
  if (item.labelParams) return t(item.labelKey, item.labelParams, { default: item.label ?? '' })
  return t(item.labelKey, item.label ?? '')
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
  <ul
    ref="menu"
    class="menu m-0 list-none p-1"
    :class="{ 'flex flex-col gap-0.5': hasIcons }"
    role="menu"
  >
    <template v-for="(item, idx) in items" :key="idx">
      <li
        v-if="item.kind === 'separator'"
        class="separator -mx-1 my-1 h-px bg-border opacity-100"
        role="separator"
      />
      <li
        v-else
        class="item box-border flex h-7 cursor-pointer items-center gap-2 rounded-md px-3 py-0 text-xs whitespace-nowrap transition-[background-color] duration-[80ms] ease-[ease] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
        :role="item.id ? 'menuitem' : 'none'"
        :data-index="idx"
        :tabindex="item.id ? -1 : undefined"
        :aria-label="appLabelOf(item)"
        :data-testid="item.app ? 'title-popup-app' : undefined"
        @click="handleClick(item)"
      >
        <span
          v-if="item.app"
          class="grid size-5 shrink-0 place-items-center overflow-hidden rounded-sm bg-secondary text-muted-foreground"
          aria-hidden="true"
        >
          <img
            v-if="pictureOf(item)"
            :src="pictureOf(item) ?? undefined"
            alt=""
            class="size-full object-cover"
            draggable="false"
            @error="brokenPictures.add(item.app.picture ?? '')"
          />
          <AppWindow v-else :size="12" />
        </span>
        <component
          :is="MENU_ICONS[item.icon]"
          v-else-if="item.icon"
          :size="15"
          class="item-icon shrink-0"
          aria-hidden="true"
        />
        <span class="label flex-auto overflow-hidden text-ellipsis">{{ labelFor(item) }}</span>
        <template v-if="item.app">
          <LoaderCircle
            v-if="item.app.state === 'running'"
            :size="14"
            class="shrink-0 animate-spin text-muted-foreground [animation-duration:900ms] motion-reduce:animate-none"
            aria-hidden="true"
            data-testid="title-popup-app-running"
          />
          <span
            v-else
            class="flex shrink-0 items-center gap-1.5 text-muted-foreground"
            aria-hidden="true"
            data-testid="title-popup-app-ready"
          >
            <span class="size-1.5 rounded-full bg-current" />
            {{ t('titleBar.ready') }}
          </span>
        </template>
      </li>
    </template>
  </ul>
</template>
