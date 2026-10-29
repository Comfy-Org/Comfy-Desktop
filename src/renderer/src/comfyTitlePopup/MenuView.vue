<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

interface MenuItem {
  id?: string
  /** English fallback when `labelKey` is set. */
  label?: string
  labelKey?: string
  checked?: boolean
  kind?: 'separator'
}

defineProps<{
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
</script>

<template>
  <ul class="menu m-0 list-none p-1">
    <template v-for="(item, idx) in items" :key="idx">
      <li
        v-if="item.kind === 'separator'"
        class="separator mx-1.5 my-1 h-px bg-border opacity-100"
        role="separator"
      />
      <li
        v-else
        class="item box-border flex h-8 cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-0 whitespace-nowrap transition-[background-color] duration-[80ms] ease-[ease] hover:bg-[oklch(1_0_0/0.07)]"
        role="menuitem"
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
