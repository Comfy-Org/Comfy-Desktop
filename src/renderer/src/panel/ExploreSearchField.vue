<script setup lang="ts">
import { ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { Search, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { placeholder } = defineProps<{ placeholder: string }>()
const query = defineModel<string>({ required: true })

const { t } = useI18n()
const field = ref<HTMLInputElement>()
const shortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ /' : 'Ctrl /'

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== '/' || !(event.metaKey || event.ctrlKey)) return
  event.preventDefault()
  field.value?.focus()
})

function onEscape(event: KeyboardEvent): void {
  if (query.value) query.value = ''
  else (event.target as HTMLInputElement).blur()
}
</script>

<template>
  <label
    class="flex h-8 w-[220px] items-center gap-2 rounded-[10px] bg-secondary pr-2 pl-2.5 text-subtle-foreground shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] transition-shadow duration-150 focus-within:shadow-[inset_0_0_0_1px_var(--color-border-focus)]"
  >
    <Search :size="14" aria-hidden="true" />
    <input
      ref="field"
      v-model="query"
      type="search"
      class="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-ui text-foreground outline-none placeholder:text-subtle-foreground [&::-webkit-search-cancel-button]:hidden"
      :placeholder
      :aria-label="placeholder"
      @keydown.esc="onEscape"
    />
    <kbd
      v-if="!query"
      class="flex-none rounded-[4px] bg-white/8 px-[5px] py-px font-[inherit] text-[11px] text-subtle-foreground"
      aria-hidden="true"
    >
      {{ shortcutLabel }}
    </kbd>
    <button
      v-else
      type="button"
      class="inline-flex size-5 items-center justify-center rounded-md text-subtle-foreground hover:text-foreground"
      :aria-label="t('explore.clearSearch')"
      data-testid="explore-search-clear"
      @click="query = ''"
    >
      <X :size="13" aria-hidden="true" />
    </button>
  </label>
</template>
