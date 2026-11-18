<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Tooltip from '../components/ui/Tooltip.vue'

const { t } = useI18n()
</script>

<template>
  <Tooltip :text="t('apps.premium.tooltip')" data-testid="premium-app-badge">
    <span
      class="grid size-7 place-items-center rounded-lg bg-[rgb(14_14_16/0.28)] backdrop-blur-[14px] backdrop-saturate-150"
      data-testid="premium-app-square"
    >
      <svg
        viewBox="0 0 24 24"
        class="size-4 text-[var(--upgrade)]"
        aria-hidden="true"
        data-testid="premium-app-crown"
      >
        <path
          fill="currentColor"
          d="M19 19H5c-.5 0-.9-.3-1-.8l-2-10c0-.4.1-.8.5-1.1c.4-.2.8-.2 1.1 0l4.1 3.3l3.4-5.1c.4-.6 1.3-.6 1.7 0l3.4 5.1l4.1-3.3c.3-.3.8-.3 1.1 0c.4.2.5.6.5 1.1l-2 10c0 .5-.5.8-1 .8z"
        />
      </svg>
      <span class="sr-only">{{ t('apps.premium.title') }}</span>
    </span>
  </Tooltip>
</template>
