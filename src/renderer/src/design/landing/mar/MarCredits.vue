<script setup lang="ts">
import { Coins } from 'lucide-vue-next'
import { shownCredits } from '../account'
import { creditsShort, creditsStyle, creditsTotal } from './credits'
import MarCreditsFlyout from './MarCreditsFlyout.vue'

/** Credits at the foot of Pablo's sidebar in Mar's proposal (Classic),
 *  in the picked style: a meter under the workspace, or a small chip.
 *  The Row style is Pablo's own Credits row, so nothing renders here.
 *  Either opens the credits flyout. */
</script>

<template>
  <MarCreditsFlyout v-if="shownCredits && creditsStyle.id === 'meter'">
    <button type="button" class="mar-credits-meter">
      <span class="flex items-center justify-between">
        <span>{{ creditsTotal }} credits</span><span class="text-subtle-foreground">Top up</span>
      </span>
      <span class="mar-credits-bar"><span /></span>
    </button>
  </MarCreditsFlyout>
  <MarCreditsFlyout v-else-if="shownCredits && creditsStyle.id === 'chip'">
    <button type="button" class="mar-credits-chip" :title="`${creditsTotal} credits`">
      <Coins :size="13" />{{ creditsShort }} credits
    </button>
  </MarCreditsFlyout>
</template>

<style>
/* Global: buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-credits-meter {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  color: var(--color-base-foreground);
  font-size: 12px;
  text-align: left;
}
.mar-credits-meter > span:first-child {
  width: 100%;
}
.mar-credits-bar {
  display: block;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mar-credits-bar > span {
  display: block;
  width: 62%;
  height: 100%;
  border-radius: inherit;
  background: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-credits-chip {
  display: inline-flex;
  width: auto;
  height: 26px;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  margin-left: 6px;
  padding: 0 10px;
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
</style>
