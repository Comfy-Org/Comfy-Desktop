<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

interface MenuItem {
  id?: string
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
        class="separator mx-1 my-1 h-px bg-border opacity-100"
        role="separator"
      />
      <li
        v-else
        class="item box-border flex h-8 cursor-pointer items-center gap-2 rounded-md px-3 py-0 whitespace-nowrap transition-[background-color] duration-[80ms] ease-[ease] hover:bg-accent"
        role="menuitem"
        tabindex="-1"
        @click="handleClick(item)"
      >
        <span class="label flex-auto overflow-hidden text-ellipsis">{{ labelFor(item) }}</span>
        <Check v-if="item.checked" class="check shrink-0" :size="15" aria-hidden="true" />
      </li>
    </template>
  </ul>
</template>
