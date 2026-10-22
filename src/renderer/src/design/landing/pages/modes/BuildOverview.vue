<script setup lang="ts">
import { computed } from 'vue'
import { Copy, Plus, Rocket } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import EmptyState from '../../ui/EmptyState.vue'
import PageHeader from '../../ui/PageHeader.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import Sparkline from '../../ui/Sparkline.vue'
import StatusDot from '../../ui/StatusDot.vue'
import CloudSignInCta from '../../parts/CloudSignInCta.vue'
import StatTile from '../../parts/env/StatTile.vue'
import { deployments, envById, fmt, fmtCompact } from '../../parts/env/env'
import { deployEnv, go, instances, proto, toast } from '../../useProto'

/** Build home: is my API healthy, and what does it cost. */
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
const firstLocal = computed(() => instances.value.find((i) => i.kind === 'local'))
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
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader title="Overview" description="Your API across every deployment, last 7 days.">
      <template #actions>
        <Button size="lg" @click="toast('Opening docs.comfy.org ↗')">Docs</Button>
        <Button
          v-if="firstLocal && proto.signedIn"
          variant="primary"
          size="lg"
          @click="deployEnv(firstLocal.id)"
          ><Plus :size="15" />Deployment</Button
        >
      </template>
    </PageHeader>

    <CloudSignInCta
      v-if="!proto.signedIn"
      title="Deploy ComfyUI as an API"
      body="Log in to deploy a build behind an endpoint that scales with traffic."
    />
    <EmptyState
      v-else-if="!deployments.length"
      :icon="Rocket"
      title="No deployments yet"
      description="Pick a build, freeze a version and get an endpoint."
    >
      <Button v-if="firstLocal" variant="primary" @click="deployEnv(firstLocal.id)"
        >Deploy {{ firstLocal.name }}</Button
      >
    </EmptyState>
    <template v-else>
      <Card class="grid grid-cols-4 divide-x divide-border-default">
        <StatTile label="Requests" :value="fmtCompact(total)"
          ><Sparkline :values="trend"
        /></StatTile>
        <StatTile
          label="Error rate"
          :value="`${errorRate.toFixed(1)}%`"
          hint="Across all deployments"
        />
        <StatTile label="p95 latency" value="9.1 s" hint="Including cold starts" />
        <StatTile label="Spend" :value="fmt(spend)" hint="credits" />
      </Card>

      <section class="mt-10">
        <SectionHeader title="Deployments" link="All deployments" @link="go('deployments')" />
        <Card class="overflow-hidden">
          <div
            v-for="d in deployments"
            :key="d.id"
            role="button"
            tabindex="0"
            class="grid min-h-13 cursor-pointer grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_120px_90px_96px] items-center gap-4 border-b border-border-default px-4 outline-none last:border-b-0 hover:bg-secondary-background/50 focus-visible:bg-secondary-background"
            @click="go(`deployment:${d.id}`)"
            @keydown.enter="go(`deployment:${d.id}`)"
          >
            <span class="min-w-0"
              ><span class="block truncate font-mono text-ui">{{ d.name }}</span
              ><span class="text-ui text-subtle-foreground">{{ d.stage }}</span></span
            >
            <span class="truncate text-ui text-muted-foreground"
              >{{ envById(d.envId)?.name }} · {{ d.version }}</span
            >
            <span class="flex items-center gap-1.5 text-ui text-muted-foreground"
              ><StatusDot :status="d.status === 'running' ? 'running' : 'idle'" />{{
                d.status === 'running' ? 'Running' : 'Scaled to zero'
              }}</span
            >
            <span class="text-right text-ui tabular-nums">{{ fmtCompact(d.requests7d) }}</span>
            <Sparkline :values="d.trend" :width="88" :height="20" />
          </div>
        </Card>
      </section>

      <div class="mt-10 grid grid-cols-2 gap-4">
        <section>
          <SectionHeader title="Recent failures" link="Logs" @link="go('logs')" />
          <Card class="overflow-hidden">
            <div
              v-for="f in FAILURES"
              :key="f.when"
              class="flex min-h-13 items-center gap-3 border-b border-border-default px-4 last:border-b-0"
            >
              <span class="size-1.5 shrink-0 rounded-full bg-status-danger" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-ui">{{ f.error }}</p>
                <p class="text-ui text-subtle-foreground">{{ f.deployment }} · {{ f.when }}</p>
              </div>
              <span class="font-mono text-ui text-subtle-foreground">{{ f.code }}</span>
            </div>
          </Card>
        </section>
        <section>
          <SectionHeader title="Quick start" />
          <Card class="p-4">
            <pre class="overflow-x-auto font-mono text-ui leading-relaxed text-muted-foreground">
curl -X POST {{ deployments[0]!.endpoint }} \
  -H "Authorization: Bearer $COMFY_API_KEY" \
  -d '{"inputs": {"prompt": "..."}}'</pre
            >
            <div class="mt-3 flex gap-2">
              <Button size="sm" @click="toast('Copied')"><Copy :size="13" />Copy</Button>
              <Button variant="ghost" size="sm" @click="go('keys')">Get an API key</Button>
            </div>
          </Card>
        </section>
      </div>
    </template>
  </div>
</template>
