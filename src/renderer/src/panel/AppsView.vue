<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppsHost from './AppsHost.vue'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'

defineProps<{ obscured?: boolean }>()

const { t } = useI18n()
const loadFailedUrl = ref<string | null>(null)
const appOpen = ref(false)
</script>

<template>
  <div
    class="flex min-h-0 w-full flex-auto flex-col"
    :class="PAGE_SPOTLIGHT_CLASS"
    data-testid="apps-view"
  >
    <header v-if="!appOpen || loadFailedUrl" class="mx-auto w-full max-w-300 px-10 pt-9 pb-3">
      <h1 class="m-0 font-display text-display font-semibold text-foreground">
        {{ t('sidebar.apps') }}
      </h1>
    </header>
    <AppsHost
      v-if="!loadFailedUrl"
      :obscured="obscured"
      @failed="loadFailedUrl = $event"
      @app-open="appOpen = $event"
    />
    <p
      v-else
      class="mx-auto mt-2 mb-0 w-full max-w-300 px-10 text-ui text-muted-foreground"
      data-testid="apps-load-failed"
    >
      {{ t('apps.loadFailed', { url: loadFailedUrl }) }}
    </p>
  </div>
</template>
