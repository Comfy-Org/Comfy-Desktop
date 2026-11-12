<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUpCircle, CircleCheck, Loader2, RefreshCw } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import BuildChannelMenu from './BuildChannelMenu.vue'
import { factsOf, pendingOf, stateOf, updateBuild } from './buildFacts'
import './buildTabs.css'

/**
 * Up to date or not, first thing on the page (UI Playground › Build page ›
 * Overview first): an icon, one line and the action. The channel sits in
 * that line, once, as a menu that says what each channel means. Beside
 * the button, the note that an update can be undone.
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const facts = factsOf(env)
const state = stateOf(env)
const pending = computed(() => pendingOf(env))
</script>

<template>
  <Card class="mar-bt-update" :class="pending && 'is-pending'">
    <span class="mar-bt-update-icon">
      <Loader2 v-if="state.updating" :size="18" class="animate-spin" />
      <ArrowUpCircle v-else-if="pending" :size="18" />
      <CircleCheck v-else :size="18" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="mar-bt-title">
        <template v-if="state.updating">Updating to {{ pending }}…</template>
        <template v-else-if="pending">ComfyUI {{ pending }} is available</template>
        <template v-else>Up to date</template>
      </p>
      <p class="mar-bt-sub bus-line">
        <template v-if="pending">You’re on {{ state.version }}</template>
        <template v-else>ComfyUI {{ state.version }}</template>
        <span aria-hidden="true">·</span>
        <BuildChannelMenu :env />
        <span aria-hidden="true">·</span>
        <span>checked {{ facts.checked }}</span>
      </p>
    </div>
    <span v-if="pending && !state.updating" class="bus-safe">Saves a snapshot first</span>
    <Button v-if="pending" variant="primary" :disabled="state.updating" @click="updateBuild(env)"
      ><ArrowUpCircle :size="14" />Update Now</Button
    >
    <Button v-else variant="ghost" @click="toast(`${env.name} is up to date`)"
      ><RefreshCw :size="13" />Check for updates</Button
    >
  </Card>
</template>
