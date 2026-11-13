<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUpRight, Check, Copy, Plus, Rocket } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import Sparkline from '../../ui/Sparkline.vue'
import CloudSignInCta from '../../parts/CloudSignInCta.vue'
import { deployments, envById, fmt, fmtCompact } from '../../parts/env/env'
import { deployEnv, go, instances, proto, toast } from '../../useProto'
import MarPage from '../pages/MarPage.vue'
import MarSeg from '../pages/MarSeg.vue'
import MarStatus from '../pages/MarStatus.vue'

/**
 * Build's overview in Mar's proposal. It answers, in order: is my API
 * healthy (the four numbers, big), does anything need me (failures, only
 * when there are some), what's running (deployments as cards, busiest
 * first) and how do I call it (code, in the language you use).
 */
const total = computed(() => deployments.value.reduce((n, d) => n + d.requests7d, 0))
const spend = computed(() => deployments.value.reduce((n, d) => n + d.spend7d, 0))
const errorRate = computed(() =>
  total.value
    ? deployments.value.reduce((n, d) => n + d.errorRate * d.requests7d, 0) / total.value
    : 0
)
const trend = computed(() =>
  [0, 1, 2, 3, 4, 5, 6].map((i) => deployments.value.reduce((n, d) => n + (d.trend[i] ?? 0), 0))
)
const BUDGET = 80000
const busiest = computed(() =>
  [...deployments.value].sort((a, b) => b.requests7d - a.requests7d).slice(0, 6)
)
const firstLocal = computed(() => instances.value.find((i) => i.kind === 'local'))
const deploy = (): void => {
  if (firstLocal.value) deployEnv(firstLocal.value.id)
}

const FAILURES = [
  {
    when: '4 min ago',
    deployment: 'product-shots-staging',
    error: 'CUDA out of memory · KSampler',
    code: 500
  },
  {
    when: '1 h ago',
    deployment: 'product-shots',
    error: 'Input image missing: product_ref.jpg',
    code: 422
  },
  {
    when: '3 h ago',
    deployment: 'hero-shot-api',
    error: 'Timed out after 120 s (cold start)',
    code: 504
  }
]

const LANGS = ['cURL', 'Python', 'JavaScript'] as const
const lang = ref<(typeof LANGS)[number]>('cURL')
const LANG_OPTIONS = LANGS.map((l) => ({ value: l, label: l }))
const endpoint = computed(() => deployments.value[0]?.endpoint ?? 'https://api.comfy.org/run')
const code = computed(() => {
  if (lang.value === 'Python')
    return `import comfy\n\nclient = comfy.Client()  # reads COMFY_API_KEY\nresult = client.run(\n    "${endpoint.value}",\n    inputs={"prompt": "..."},\n)`
  if (lang.value === 'JavaScript')
    return `import { Comfy } from '@comfyorg/sdk'\n\nconst comfy = new Comfy() // reads COMFY_API_KEY\nconst result = await comfy.run('${endpoint.value}', {\n  inputs: { prompt: '...' }\n})`
  return `curl -X POST ${endpoint.value} \\\n  -H "Authorization: Bearer $COMFY_API_KEY" \\\n  -d '{"inputs": {"prompt": "..."}}'`
})
const copied = ref(false)
function copy(): void {
  copied.value = true
  toast('Copied')
  setTimeout(() => (copied.value = false), 1400)
}
</script>

<template>
  <MarPage
    title="Overview"
    skeleton="cards"
    class="mar-build"
    :state="proto.signedIn && !deployments.length ? 'empty' : undefined"
    :empty="{
      icon: Rocket,
      title: 'No deployments yet',
      text: 'Pick a build, freeze a version and get an endpoint.',
      action: firstLocal ? `Deploy ${firstLocal.name}` : 'Deploy a build'
    }"
    @action="deploy"
  >
    <template #actions>
      <Button @click="toast('Opening docs.comfy.org ↗')">Docs<ArrowUpRight :size="14" /></Button>
      <Button v-if="firstLocal && proto.signedIn" variant="primary" @click="deploy"
        ><Plus :size="15" />Deployment</Button
      >
    </template>

    <CloudSignInCta
      v-if="!proto.signedIn"
      title="Deploy ComfyUI as an API"
      body="Log in to deploy a build behind an endpoint that scales with traffic."
    />
    <template v-else>
      <!-- Health: four numbers, big, each on its own surface. -->
      <section class="grid grid-cols-4 gap-3">
        <div class="mar-build-stat mar-surface">
          <span class="mar-build-label">Requests</span>
          <span class="mar-build-value">{{ fmtCompact(total) }}</span>
          <Sparkline :values="trend" :width="220" :height="34" class="mar-build-spark" />
        </div>
        <div class="mar-build-stat mar-surface">
          <span class="mar-build-label">Error rate</span>
          <span class="mar-build-value">{{ errorRate.toFixed(1) }}<small>%</small></span>
          <span class="mar-build-hint"
            ><i class="mar-build-dot" :class="errorRate < 1 ? 'is-ok' : 'is-bad'" />{{
              errorRate < 1 ? 'Healthy' : 'Above 1%'
            }}</span
          >
        </div>
        <div class="mar-build-stat mar-surface">
          <span class="mar-build-label">p95 latency</span>
          <span class="mar-build-value">9.1<small>s</small></span>
          <span class="mar-build-hint">Including cold starts</span>
        </div>
        <div class="mar-build-stat mar-surface">
          <span class="mar-build-label">Spend</span>
          <span class="mar-build-value">{{ fmtCompact(spend) }}<small>credits</small></span>
          <span class="mar-build-meter"
            ><span :style="{ width: `${Math.min(100, (spend / BUDGET) * 100)}%` }"
          /></span>
          <span class="mar-build-hint"
            >{{ Math.round((spend / BUDGET) * 100) }}% of the monthly budget</span
          >
        </div>
      </section>

      <!-- Needs you: only what failed, right under the health numbers. -->
      <section v-if="FAILURES.length" class="mt-8">
        <SectionHeader
          class="mar-sec"
          title="Needs attention"
          link="Open logs"
          @link="go('logs')"
        />
        <div class="grid grid-cols-3 gap-3">
          <button
            v-for="f in FAILURES"
            :key="f.when"
            type="button"
            class="mar-build-fail mar-surface"
            @click="go('logs')"
          >
            <span class="flex items-center justify-between">
              <MarStatus status="failed" :label="String(f.code)" />
              <span class="text-ui text-subtle-foreground">{{ f.when }}</span>
            </span>
            <span class="line-clamp-2 text-left text-ui text-base-foreground">{{ f.error }}</span>
            <span class="truncate font-mono text-[12px] text-subtle-foreground">{{
              f.deployment
            }}</span>
          </button>
        </div>
      </section>

      <!-- What's running: the busiest deployments as cards. -->
      <section class="mt-10">
        <SectionHeader
          class="mar-sec"
          title="Deployments"
          link="See all"
          @link="go('deployments')"
        />
        <div class="grid grid-cols-3 gap-3">
          <button
            v-for="d in busiest"
            :key="d.id"
            type="button"
            class="mar-build-dep mar-surface"
            @click="go(`deployment:${d.id}`)"
          >
            <span class="flex items-center justify-between gap-3">
              <span class="truncate font-mono text-ui text-base-foreground">{{ d.name }}</span>
              <MarStatus
                :status="d.status === 'running' ? 'running' : 'stopped'"
                :label="d.status === 'running' ? 'Running' : 'Idle'"
              />
            </span>
            <span class="truncate text-ui text-subtle-foreground"
              >{{ envById(d.envId)?.name }} · {{ d.version }} · {{ d.stage }}</span
            >
            <span class="mt-3 flex items-end justify-between gap-3">
              <span class="flex flex-col text-left">
                <span class="mar-build-num">{{ fmtCompact(d.requests7d) }}</span>
                <span class="text-[12px] text-subtle-foreground"
                  >requests · {{ fmt(d.spend7d) }} credits</span
                >
              </span>
              <Sparkline :values="d.trend" :width="110" :height="32" />
            </span>
          </button>
        </div>
      </section>

      <!-- How to call it, in your language. -->
      <section class="mt-10">
        <SectionHeader class="mar-sec" title="Call your API" link="API keys" @link="go('keys')" />
        <div class="mar-build-code-card mar-surface">
          <div class="flex items-center justify-between">
            <MarSeg v-model="lang" :options="LANG_OPTIONS" label="Language" />
            <Button size="sm" @click="copy"
              ><component :is="copied ? Check : Copy" :size="13" />{{
                copied ? 'Copied' : 'Copy'
              }}</Button
            >
          </div>
          <pre class="mar-build-pre">{{ code }}</pre>
        </div>
      </section>
    </template>
  </MarPage>
</template>

<style scoped>
.mar-build-stat {
  display: flex;
  min-height: 150px;
  flex-direction: column;
  gap: 6px;
  padding: 18px 20px;
  border-radius: 18px;
}
.mar-build-label {
  color: var(--color-muted-foreground);
  font-size: 13px;
}
.mar-build-value {
  font-size: 34px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.mar-build-value small {
  margin-left: 4px;
  color: var(--color-subtle-foreground);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0;
}
.mar-build-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.mar-build-spark {
  width: 100%;
  margin-top: auto;
}
.mar-build-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
}
.mar-build-dot.is-ok {
  background: var(--color-status-running, #4ade80);
}
.mar-build-dot.is-bad {
  background: var(--color-status-danger, #f87171);
}
.mar-build-meter {
  display: block;
  height: 4px;
  margin-top: auto;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mar-build-meter > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-base-foreground);
}
.mar-build-fail,
.mar-build-dep {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  padding: 16px 18px;
  border-radius: 18px;
  text-align: left;
}
.mar-build-fail {
  box-shadow: inset 2px 0 0
    color-mix(in oklch, var(--color-status-danger, #f87171) 70%, transparent);
}
.mar-build-num {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.mar-build-code-card {
  padding: 14px;
  border-radius: 18px;
}
.mar-build-pre {
  margin-top: 12px;
  overflow-x: auto;
  padding: 16px;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-content-background) 70%, transparent);
  color: var(--color-muted-foreground);
  font-family: ui-monospace, monospace;
  font-size: 13px;
  line-height: 1.7;
}
</style>

<style>
/* Global: cards and tabs here are buttons, so they go past the
   prototype's button reset (scoped styles can't reach that far). */
:root .proto-ui.proto-ui.proto-ui :is(.mar-build-fail, .mar-build-dep) {
  width: auto;
  padding: 16px 18px;
  border-radius: 18px;
  background: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  backdrop-filter: blur(20px);
  transition: background-color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui :is(.mar-build-fail, .mar-build-dep):hover {
  background: color-mix(in oklch, var(--color-card-background-hover) 80%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-build-dep {
  min-height: 150px;
}
</style>
