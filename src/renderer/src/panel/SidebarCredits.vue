<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LoaderCircle } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Tooltip from '../components/ui/Tooltip.vue'
import { useAuthStore } from '../stores/authStore'
import type { CreditBalanceState } from '../types/ipc'

const CREDITS_PER_CENT = 211 / 100

const { collapsed } = defineProps<{
  collapsed: boolean
}>()

const { t, locale } = useI18n()
const auth = useAuthStore()
const balance = ref<CreditBalanceState>({ status: 'signed_out' })

const count = computed(() =>
  balance.value.status === 'ready' ? Math.round(balance.value.cents * CREDITS_PER_CENT) : null
)
const credits = computed(() =>
  count.value === null
    ? null
    : new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }).format(count.value)
)
const shortCredits = computed(() => {
  if (count.value !== null) {
    return new Intl.NumberFormat(locale.value, { notation: 'compact' }).format(count.value)
  }
  return balance.value.status === 'error' ? '–' : ''
})
const tooltip = computed(() =>
  balance.value.status === 'error'
    ? t('sidebar.creditsError')
    : t('sidebar.creditsTooltip', { credits: credits.value ?? '—' })
)
const label = computed(() =>
  t('sidebar.creditsLabel', {
    balance: tooltip.value,
    action: t('devPlatform.workspaceMenu.managePlanAndCredits')
  })
)

async function refresh(): Promise<void> {
  balance.value = await window.api.refreshCreditBalance().catch(() => balance.value)
}

function openManageCredits(): void {
  const workspaceId = auth.status.workspaceId
  if (!workspaceId) return
  void window.api.comfybuilder.openSettingsPage('billing', workspaceId).catch(() => {})
}

let unsubscribes: Array<() => void> = []
onMounted(() => {
  unsubscribes = [
    window.api.onCreditBalanceChanged((state) => (balance.value = state)),
    window.api.onAppPageClosed(refresh)
  ]
  void refresh()
})
onUnmounted(() => unsubscribes.forEach((unsubscribe) => unsubscribe()))
</script>

<template>
  <Tooltip
    v-if="balance.status !== 'signed_out'"
    :text="collapsed ? tooltip : undefined"
    side="right"
    class="w-full"
  >
    <Button
      variant="muted-textonly"
      size="unset"
      class="relative w-full shrink-0 flex-col items-stretch justify-start overflow-hidden rounded-lg px-0 text-[13px]/5 font-normal transition-[height] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-secondary hover:text-foreground motion-reduce:transition-none"
      :class="collapsed ? 'h-11 duration-300' : 'h-8 duration-260'"
      :aria-label="label"
      :disabled="!auth.status.workspaceId"
      data-testid="app-sidebar-credits"
      @pointerenter="refresh"
      @click="openManageCredits"
    >
      <span class="flex h-8 w-full shrink-0 items-center gap-2.5 px-3">
        <svg
          viewBox="0 0 16 16"
          class="size-[15px] shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.3]"
          aria-hidden="true"
        >
          <path
            d="M12.0597 6.91211C12.6899 7.14706 13.2507 7.53713 13.6902 8.04624C14.1297 8.55535 14.4338 9.16707 14.5742 9.82482C14.7147 10.4826 14.687 11.1651 14.4938 11.8093C14.3005 12.4536 13.948 13.0387 13.4687 13.5105C12.9894 13.9824 12.3989 14.3258 11.7517 14.5089C11.1046 14.6921 10.4217 14.7091 9.76619 14.5584C9.11071 14.4077 8.50381 14.0942 8.00162 13.6468C7.49943 13.1994 7.11816 12.6326 6.89307 11.9988M4.66634 3.9987H5.33301V6.66536M11.1397 9.25195L11.6064 9.72529L9.7264 11.6053M9.33301 5.33203C9.33301 7.54117 7.54215 9.33203 5.33301 9.33203C3.12387 9.33203 1.33301 7.54117 1.33301 5.33203C1.33301 3.12289 3.12387 1.33203 5.33301 1.33203C7.54215 1.33203 9.33301 3.12289 9.33301 5.33203Z"
          />
        </svg>
        <Transition
          enter-active-class="transition-opacity duration-180 delay-30 ease-out"
          enter-from-class="opacity-0"
          leave-active-class="transition-opacity duration-150 ease-out"
          leave-to-class="opacity-0"
        >
          <span
            v-if="!collapsed"
            class="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden text-nowrap"
          >
            <span class="min-w-0 flex-1 truncate text-left">{{ t('sidebar.credits') }}</span>
            <LoaderCircle
              v-if="balance.status === 'loading'"
              :size="14"
              class="shrink-0 animate-spin text-subtle-foreground [animation-duration:900ms] motion-reduce:animate-none"
              aria-hidden="true"
              data-testid="app-sidebar-credits-loading"
            />
            <span v-else-if="balance.status === 'error'" class="shrink-0 text-subtle-foreground">{{
              t('sidebar.creditsError')
            }}</span>
            <span
              v-else
              class="shrink-0 text-foreground tabular-nums"
              data-testid="app-sidebar-credits-value"
              >{{ credits }}</span
            >
          </span>
        </Transition>
      </span>
      <Transition
        enter-active-class="transition-opacity duration-180 delay-30 ease-out"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-150 ease-out"
        leave-to-class="opacity-0"
      >
        <span
          v-if="collapsed"
          class="absolute top-[25px] left-0 w-10 text-center text-2xs/tight text-foreground tabular-nums"
          data-testid="app-sidebar-credits-short"
          >{{ shortCredits }}</span
        >
      </Transition>
    </Button>
  </Tooltip>
</template>
