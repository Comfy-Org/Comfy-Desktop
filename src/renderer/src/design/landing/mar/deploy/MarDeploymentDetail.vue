<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, Copy, KeyRound, Pause, Play, SquareArrowOutUpRight } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import Select from '../../ui/Select.vue'
import StatusDot from '../../ui/StatusDot.vue'
import InstanceGlyph from '../../parts/InstanceGlyph.vue'
import { envById, fmt, fmtCompact, versionsOf } from '../../parts/env/env'
import { spaceById } from '../../spaces'
import { go, goIn, hostActions, toast } from '../../useProto'
import type { Deployment } from '../../mock'

/**
 * Mar's deployment page. Same facts and actions as Pablo's
 * (pages/modes/DeploymentDetail.vue), laid out for balance: four stats
 * with one anatomy (label, value, hint), then how you call it on the left
 * and what it serves and runs on, stacked on the right.
 */
const { dep } = defineProps<{ dep: Deployment }>()
const env = computed(() => envById(dep.envId))
const space = computed(() => (dep.spaceId ? spaceById(dep.spaceId) : undefined))
const running = computed(() => dep.status === 'running')

// The version it serves is always an option, so the select shows a value
// even when it follows "latest" or serves one not in this build's list.
const published = computed(() =>
  env.value ? versionsOf(env.value).filter((v) => v.published || v.id === dep.version) : []
)
const versionOptions = computed(() => {
  const opts = published.value.map((v) => ({
    value: v.id,
    label: `${v.label} · ${v.note}`,
    hint: v.id === dep.version ? 'Serving' : v.when
  }))
  if (dep.version === 'latest')
    opts.unshift({
      value: 'latest',
      label: `Latest${published.value[0] ? ` · ${published.value[0].label}` : ''}`,
      hint: 'Serving'
    })
  else if (!published.value.some((v) => v.id === dep.version))
    opts.unshift({ value: dep.version, label: dep.version, hint: 'Serving' })
  return opts
})
const version = ref(dep.version)

const failed = computed(() => Math.round((dep.requests7d * dep.errorRate) / 100))
const stats = computed(() => [
  { label: 'Requests', value: fmtCompact(dep.requests7d), hint: 'Last 7 days' },
  { label: 'Error rate', value: `${dep.errorRate}%`, hint: `${fmt(failed.value)} failed` },
  { label: 'p95 latency', value: dep.p95, hint: 'Per request' },
  { label: 'Spend', value: fmt(dep.spend7d), hint: 'Credits, last 7 days' }
])

const curl = computed(
  () =>
    `curl -X POST ${dep.endpoint} \\\n  -H "Authorization: Bearer $COMFY_API_KEY" \\\n  -d '{"inputs": {"prompt": "..."}}'`
)
function copy(text: string, what: string): void {
  void navigator.clipboard?.writeText(text).catch(() => {})
  toast(what)
}
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <Button variant="link" size="sm" class="mt-6" @click="go('deployments')"
      ><ChevronLeft :size="14" />Deployments</Button
    >

    <header class="flex items-end gap-4 pt-5 pb-6">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2.5">
          <h1 class="truncate font-mono text-title font-semibold">{{ dep.name }}</h1>
          <Badge size="md">{{ dep.stage }}</Badge>
        </div>
        <p class="mt-1.5 flex items-center gap-2 text-ui text-muted-foreground">
          <StatusDot :status="running ? 'running' : 'idle'" />
          <span class="text-base-foreground">{{ running ? 'Running' : 'Scaled to zero' }}</span>
          <template v-if="space && dep.tool"
            ><span class="text-subtle-foreground">·</span>Serves {{ dep.tool }} in
            {{ space.name }}</template
          >
        </p>
      </div>
      <Button size="lg" @click="toast(running ? 'Pausing…' : 'Resuming…')">
        <component :is="running ? Pause : Play" :size="13" />{{ running ? 'Pause' : 'Resume' }}
      </Button>
    </header>

    <Card class="grid grid-cols-4 divide-x divide-border-default">
      <div v-for="s in stats" :key="s.label" class="flex min-w-0 flex-col gap-1 px-5 py-4">
        <span class="text-ui text-subtle-foreground">{{ s.label }}</span>
        <span class="text-[22px] leading-7 font-semibold tracking-[-0.01em] tabular-nums">{{
          s.value
        }}</span>
        <span class="truncate text-ui text-subtle-foreground">{{ s.hint }}</span>
      </div>
    </Card>

    <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <!-- How you call it -->
      <Card class="flex flex-col">
        <header class="px-5 pt-4 pb-3">
          <h2 class="text-ui font-semibold">Endpoint</h2>
          <p class="mt-0.5 text-ui text-subtle-foreground">
            POST inputs, get outputs back. Authenticate with a workspace API key.
          </p>
        </header>
        <div class="flex flex-1 flex-col gap-4 px-5 pb-5">
          <div class="flex flex-col gap-1.5">
            <span class="text-ui text-muted-foreground">URL</span>
            <div
              class="flex h-9 items-center gap-2 rounded-control border border-border-default bg-secondary-background/60 pr-1 pl-3"
            >
              <code class="min-w-0 flex-1 truncate font-mono text-ui">{{ dep.endpoint }}</code>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Copy URL"
                @click="copy(dep.endpoint, 'URL copied')"
                ><Copy :size="13"
              /></Button>
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <span class="text-ui text-muted-foreground">Example request</span>
            <div class="relative">
              <pre
                class="overflow-x-auto rounded-control border border-border-default bg-secondary-background/60 py-3 pr-12 pl-3 font-mono text-ui leading-relaxed text-muted-foreground"
                >{{ curl }}</pre
              >
              <Button
                variant="ghost"
                size="icon-sm"
                class="absolute top-1.5 right-1.5"
                aria-label="Copy request"
                @click="copy(curl, 'Request copied')"
                ><Copy :size="13"
              /></Button>
            </div>
          </div>
        </div>
        <footer
          class="flex items-center justify-between gap-3 border-t border-border-default px-5 py-3"
        >
          <span class="text-ui text-muted-foreground">Sent as Authorization: Bearer</span>
          <Button size="sm" @click="go('keys')"><KeyRound :size="13" />Manage keys</Button>
        </footer>
      </Card>

      <div class="flex flex-col gap-4">
        <!-- What it serves -->
        <Card class="flex flex-col">
          <header class="px-5 pt-4 pb-3">
            <h2 class="text-ui font-semibold">Source</h2>
            <p class="mt-0.5 text-ui text-subtle-foreground">
              Change the version to roll forward or back.
            </p>
          </header>
          <dl class="flex flex-col gap-3 px-5 pb-4">
            <div v-if="env" class="flex items-center justify-between gap-3">
              <dt class="text-ui text-muted-foreground">Build</dt>
              <dd>
                <Button
                  variant="ghost"
                  size="sm"
                  class="-mr-2.5 text-base-foreground"
                  @click="goIn('create', `environment:${env.id}`)"
                  ><InstanceGlyph :inst="env" size="xs" />{{ env.name }}</Button
                >
              </dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-ui text-muted-foreground">Version</dt>
              <dd class="min-w-0">
                <Select v-model="version" size="sm" class="max-w-56" :options="versionOptions" />
              </dd>
            </div>
          </dl>
          <footer
            v-if="env"
            class="flex items-center justify-between gap-3 border-t border-border-default px-5 py-3"
          >
            <span class="text-ui text-muted-foreground">Save a version there, then deploy it</span>
            <Button size="sm" @click="hostActions.launch(env)"
              ><SquareArrowOutUpRight :size="13" />Open in ComfyUI</Button
            >
          </footer>
        </Card>

        <!-- What it runs on -->
        <Card class="flex flex-1 flex-col">
          <header class="px-5 pt-4 pb-3">
            <h2 class="text-ui font-semibold">Scaling</h2>
            <p class="mt-0.5 text-ui text-subtle-foreground">
              Workers start on demand. A cold start takes about 40 seconds.
            </p>
          </header>
          <dl class="mt-auto grid grid-cols-2 border-t border-border-default">
            <div class="flex flex-col gap-0.5 px-5 py-3">
              <dt class="text-ui text-subtle-foreground">GPU</dt>
              <dd class="text-ui font-medium">{{ dep.gpu }}</dd>
            </div>
            <div class="flex flex-col gap-0.5 border-l border-border-default px-5 py-3">
              <dt class="text-ui text-subtle-foreground">Workers · min–max</dt>
              <dd class="text-ui font-medium tabular-nums">{{ dep.workers }}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  </div>
</template>
