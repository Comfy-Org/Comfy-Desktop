<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUpRight, Check, Copy, Link2, Loader2, Lock, Rocket, Users } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Input from '../../ui/Input.vue'
import { cn } from '../../ui/cn'
import { thumb } from '../../mock'
import {
  ACCESS_OPTIONS,
  CHECKS,
  copyLink,
  dialogs,
  flow,
  libApp,
  openApp,
  openAppUrl,
  publish,
  usd
} from '../../appFlow'

/**
 * The one place where an app goes live, whichever way it was made: what
 * it is, who can use it, the checks, one button. Agents fill it in; the
 * person presses Publish.
 */
const emit = defineEmits<{ live: [id: string] }>()
const d = computed(() => flow.draft)
const live = computed(() => libApp(flow.appId))
function openUrl(id: string): void {
  dialogs.publish = false
  openAppUrl(id)
}
function openPage(id: string): void {
  dialogs.publish = false
  openApp(id)
}
const ICON = { 'only-you': Lock, team: Users, link: Link2 }
</script>

<template>
  <div v-if="d" class="flex flex-col gap-6">
    <!-- What it is -->
    <div class="flex gap-4">
      <img
        :src="thumb(d.thumbId)"
        alt=""
        class="aspect-[4/3] w-32 shrink-0 rounded-control border border-border-default object-cover"
      />
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <template v-if="live">
          <p class="text-heading font-semibold">{{ d.name }}</p>
          <p class="text-ui text-muted-foreground">{{ d.blurb }}</p>
        </template>
        <template v-else>
          <Input v-model="d.name" aria-label="Name" class="font-medium" />
          <Input v-model="d.blurb" aria-label="Description" />
        </template>
        <p class="text-ui text-subtle-foreground">
          {{ d.fields.filter((f) => f.on).length }} inputs · 1 output · about {{ usd(d.cost) }} a
          run, at cost
        </p>
      </div>
    </div>

    <!-- Live -->
    <div v-if="live" class="flex flex-col gap-3">
      <div class="flex items-center gap-3 rounded-card border border-border-default px-4 py-3">
        <span class="size-2 rounded-full bg-status-running" />
        <span class="min-w-0 flex-1 truncate font-mono text-ui">comfy.org/a/{{ live.slug }}</span>
        <Button size="sm" variant="ghost" @click="copyLink(live)"><Copy :size="12" />Copy</Button>
      </div>
      <div class="flex justify-end gap-2">
        <Button @click="dialogs.share = live.id"><Users :size="13" />Share…</Button>
        <Button @click="openPage(live.id)">Manage</Button>
        <Button variant="primary" @click="openUrl(live.id)"
          >Open app<ArrowUpRight :size="13"
        /></Button>
      </div>
    </div>

    <template v-else>
      <!-- Who can use it -->
      <div class="flex flex-col gap-2">
        <p class="text-ui font-medium">Who can use it</p>
        <div class="flex flex-col rounded-card border border-border-default p-1">
          <button
            v-for="o in ACCESS_OPTIONS"
            :key="o.value"
            type="button"
            :disabled="flow.checks >= 0"
            :class="
              cn(
                'flex items-center gap-3 rounded-control px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                flow.access === o.value
                  ? 'bg-secondary-background-hover'
                  : 'enabled:hover:bg-secondary-background'
              )
            "
            @click="flow.access = o.value"
          >
            <component :is="ICON[o.value]" :size="15" class="text-muted-foreground" />
            <span class="min-w-0 flex-1">
              <span class="block text-ui font-medium">{{ o.label }}</span>
              <span class="block text-ui text-subtle-foreground">{{ o.hint }}</span>
            </span>
            <Check v-if="flow.access === o.value" :size="15" />
          </button>
        </div>
      </div>

      <!-- Checks -->
      <ul v-if="flow.checks >= 0" class="flex flex-col gap-1.5">
        <li
          v-for="(c, i) in CHECKS(d)"
          :key="c"
          :class="
            cn(
              'flex items-center gap-2 text-ui transition-opacity',
              i < flow.checks ? 'text-muted-foreground' : 'opacity-40'
            )
          "
        >
          <Check v-if="i < flow.checks" :size="13" class="text-status-running" />
          <Loader2 v-else-if="i === flow.checks" :size="13" class="animate-spin" />
          <span v-else class="size-[13px]" />{{ c }}
        </li>
      </ul>

      <div class="flex items-center justify-between gap-3">
        <p class="text-ui text-subtle-foreground">You can change this at any time.</p>
        <Button
          variant="primary"
          size="lg"
          :disabled="flow.checks >= 0"
          @click="publish((id) => emit('live', id))"
        >
          <Loader2 v-if="flow.checks >= 0" :size="14" class="animate-spin" />
          <Rocket v-else :size="14" />{{ flow.checks >= 0 ? 'Publishing' : 'Publish' }}
        </Button>
      </div>
    </template>
  </div>
</template>
