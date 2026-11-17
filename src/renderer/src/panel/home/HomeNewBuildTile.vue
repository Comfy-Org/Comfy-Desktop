<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Plus } from '@lucide/vue'

const emit = defineEmits<{ open: [] }>()

const { t } = useI18n()
</script>

<template>
  <button
    type="button"
    class="group flex h-25 w-full cursor-pointer items-center gap-[38px] rounded-2xl bg-[rgb(137_137_137/0.1)] pr-6 pl-[42px] text-left outline-none transition-colors hover:bg-[rgb(137_137_137/0.16)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none"
    data-testid="home-new-build"
    @click="emit('open')"
  >
    <span
      class="flex size-11 shrink-0 items-center justify-center rounded-full bg-[rgb(137_137_137/0.2)] text-foreground transition-[transform,background-color] duration-200 ease-out group-hover:scale-105 group-hover:bg-[rgb(137_137_137/0.28)] motion-reduce:transition-none"
      aria-hidden="true"
    >
      <Plus :size="20" :stroke-width="2.25" />
    </span>
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span
        class="truncate text-[15px]/5 font-semibold text-foreground"
        data-testid="home-new-build-name"
      >
        {{ t('sidebar.newBuild') }}
      </span>
      <span class="truncate text-xs/4 text-muted-foreground">
        {{ t('home.newBuildDetail') }}
      </span>
    </span>
  </button>
</template>
