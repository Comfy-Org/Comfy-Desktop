<script setup lang="ts">
import { computed } from 'vue'
import { CreditCard, Plus, ReceiptText } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import { go, toast } from '../useProto'
import { shownWorkspace as workspace } from '../account'
import { CREDITS_POOLS, creditsState } from './credits'

/**
 * What opens from the Credits row in Mar's proposal: Alex Tov's credits
 * flyout (Figma "Credits flyout — states", FRONT-3644), in the state picked
 * in UI Playground › Credits state. The plan pool with its bar and refill
 * date on top, the top-up pool below, then the actions. Pools stop at 0; the
 * row carries the signed total (credits.ts). Add credits follows can_top_up:
 * owners only, hidden while paused or past due, dimmed while purchases are
 * stopped. Numbers follow the prototype's Billing page (credits.ts).
 */
const { side = 'right', align = 'end' } = defineProps<{
  side?: 'top' | 'right' | 'bottom'
  align?: 'start' | 'end'
}>()

const fmt = (n: number): string => n.toLocaleString('en-US')

const state = computed(() => creditsState.id)
const pools = computed(() => CREDITS_POOLS[state.value])
const isOwner = computed(() => workspace.value.role?.toUpperCase() !== 'MEMBER')
const unknown = computed(() => state.value === 'unavailable')
const loading = computed(() => state.value === 'loading')
const awaitingPayment = computed(() => state.value === 'paused' || state.value === 'pastDue')

// What is left of the plan pool, in 25% steps.
const planBar = computed(() => {
  const p = pools.value
  if (loading.value || !p.total) return '0%'
  return `${Math.round((p.left / p.total) * 4) * 25}%`
})
const planNote = computed(() => {
  if (unknown.value) return 'Couldn’t load your balance.'
  if (loading.value) return ''
  if (awaitingPayment.value) return 'Refills when the payment goes through'
  return state.value === 'yearly' ? 'Refills November 1, 2027' : 'Refills November 1'
})
const topUpNote = computed(
  () =>
    ({
      processing: 'Payment processing…',
      stopped: 'Buying credits isn’t available right now',
      noPlan: 'Buying credits doesn’t start a Cloud plan. Subscribe to run workflows on Cloud.',
      ended:
        'Buying credits doesn’t restart your Cloud plan. Resubscribe to run workflows on Cloud.'
    })[state.value as string] ?? ''
)
const showAddCredits = computed(() => isOwner.value && !awaitingPayment.value && !unknown.value)
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger as-child><slot /></DropdownMenuTrigger>
    <DropdownMenuContent :side :align :side-offset="8" class="mar-cf w-64">
      <!-- Both pools are the flyout's raised panel (mar/menus/layers.css). -->
      <div class="mar-menu-panel">
        <div v-if="pools.plan !== null" class="mar-cf-pool">
          <span class="mar-cf-line">
            <span>Plan credits</span>
            <span v-if="loading" class="mar-cf-skel w-[72px]" />
            <span v-else-if="unknown">—</span>
            <span v-else class="tabular-nums"
              ><span class="font-medium text-base-foreground">{{ fmt(pools.left) }}</span> of
              {{ fmt(pools.total) }}</span
            >
          </span>
          <span v-if="!unknown" class="mar-cf-bar"><span :style="{ width: planBar }" /></span>
          <span v-if="planNote" class="mar-cf-note">{{ planNote }}</span>
        </div>
        <div class="mar-cf-pool">
          <span class="mar-cf-line">
            <span>Top-up credits</span>
            <span v-if="loading" class="mar-cf-skel w-10" />
            <span v-else-if="unknown">—</span>
            <span v-else class="font-medium text-base-foreground tabular-nums">{{
              fmt(pools.topUp)
            }}</span>
          </span>
          <span v-if="topUpNote" class="mar-cf-note">{{ topUpNote }}</span>
        </div>
      </div>
      <DropdownMenuItem
        v-if="showAddCredits"
        :disabled="state === 'stopped'"
        @select="toast('Add credits')"
      >
        <Plus :size="15" class="text-subtle-foreground" />Add credits
      </DropdownMenuItem>
      <DropdownMenuItem v-if="isOwner && awaitingPayment" @select="toast('Update payment')">
        <CreditCard :size="15" class="text-subtle-foreground" />Update payment
      </DropdownMenuItem>
      <DropdownMenuItem @select="go('billing')">
        <ReceiptText :size="15" class="text-subtle-foreground" />Billing settings
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>

<style>
/* Global: the flyout is portalled to <body>. */
.mar-cf .mar-cf-pool {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}
.mar-cf .mar-cf-pool + .mar-cf-pool {
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mar-cf .mar-cf-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
.mar-cf .mar-cf-bar {
  display: block;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mar-cf .mar-cf-bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-base-foreground);
}
.mar-cf .mar-cf-note {
  color: var(--color-subtle-foreground);
  font-size: 12px;
  line-height: 16px;
}
.mar-cf .mar-cf-skel {
  display: block;
  height: 12px;
  align-self: center;
  border-radius: 4px;
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  animation: mar-cf-pulse 1.4s ease-in-out infinite;
}
@keyframes mar-cf-pulse {
  50% {
    opacity: 0.5;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mar-cf .mar-cf-skel {
    animation: none;
  }
}
</style>
