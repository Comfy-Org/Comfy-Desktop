<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, Copy, KeyRound, Pause, Play } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import Select from '../../ui/Select.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
import SettingsSection from '../../ui/SettingsSection.vue'
import Sparkline from '../../ui/Sparkline.vue'
import StatusDot from '../../ui/StatusDot.vue'
import InstanceGlyph from '../../parts/InstanceGlyph.vue'
import StatTile from '../../parts/env/StatTile.vue'
import { envById, fmt, fmtCompact, versionsOf } from '../../parts/env/env'
import { go, goIn, hostActions, toast } from '../../useProto'
import type { Deployment } from '../../mock'

/** A deployment: endpoint, health, scaling, and which environment version
 *  it serves - with bridges back to the environment in Create. */
const { dep } = defineProps<{ dep: Deployment }>()
const env = computed(() => envById(dep.envId))
const version = ref(dep.version)
const versions = computed(() =>
  env.value ? versionsOf(env.value).filter((v) => v.published || v.id === dep.version) : []
)
const curl = computed(
  () =>
    `curl -X POST ${dep.endpoint} \\\n  -H "Authorization: Bearer $COMFY_API_KEY" \\\n  -d '{"inputs": {"prompt": "..."}}'`
)
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <Button variant="link" size="sm" class="mt-6 -mb-4" @click="go('deployments')"
      ><ChevronLeft :size="14" />Deployments</Button
    >
    <header class="flex items-start gap-4 pt-10 pb-6">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2.5">
          <h1 class="font-mono text-title font-semibold">{{ dep.name }}</h1>
          <Badge size="md">{{ dep.stage }}</Badge>
        </div>
        <p class="mt-1 flex items-center gap-2 text-ui text-muted-foreground">
          <StatusDot :status="dep.status === 'running' ? 'running' : 'idle'" />{{
            dep.status === 'running' ? 'Running' : 'Scaled to zero'
          }}
          <span class="text-subtle-foreground">· {{ dep.gpu }} · {{ dep.workers }} workers</span>
        </p>
      </div>
      <Button size="lg" @click="toast(dep.status === 'running' ? 'Pausing…' : 'Resuming…')">
        <component :is="dep.status === 'running' ? Pause : Play" :size="13" />{{
          dep.status === 'running' ? 'Pause' : 'Resume'
        }}
      </Button>
    </header>

    <Card class="grid grid-cols-4 divide-x divide-border-default">
      <StatTile label="Requests · 7 days" :value="fmtCompact(dep.requests7d)"
        ><Sparkline :values="dep.trend"
      /></StatTile>
      <StatTile label="Error rate" :value="`${dep.errorRate}%`" />
      <StatTile label="p95 latency" :value="dep.p95" />
      <StatTile label="Spend · 7 days" :value="fmt(dep.spend7d)" hint="credits" />
    </Card>

    <div class="divide-y divide-border-default">
      <SettingsSection
        title="Endpoint"
        description="POST inputs, get outputs back. Authenticate with a workspace API key."
      >
        <SettingsRow label="URL" layout="inline">
          <code class="max-w-80 truncate font-mono text-ui">{{ dep.endpoint }}</code>
          <Button variant="ghost" size="icon-sm" aria-label="Copy URL" @click="toast('Copied')"
            ><Copy :size="13"
          /></Button>
        </SettingsRow>
        <SettingsRow label="Example">
          <pre
            class="overflow-x-auto rounded-control border border-border-default bg-black/30 p-3 font-mono text-ui leading-relaxed text-muted-foreground"
            >{{ curl }}</pre
          >
        </SettingsRow>
        <SettingsRow label="API keys" layout="inline">
          <Button size="sm" @click="go('keys')"><KeyRound :size="13" />Manage keys</Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Source"
        description="The build version this deployment serves. Change it to roll forward or back."
      >
        <SettingsRow v-if="env" label="Build" layout="inline">
          <InstanceGlyph :inst="env" size="xs" />
          <Button
            variant="ghost"
            size="sm"
            class="text-base-foreground"
            @click="goIn('create', `environment:${env.id}`)"
            >{{ env.name }}</Button
          >
        </SettingsRow>
        <SettingsRow label="Version" layout="inline">
          <Select
            v-model="version"
            variant="ghost"
            class="text-base-foreground"
            :options="versions.map((v) => ({ value: v.id, label: `${v.label} · ${v.note}` }))"
          />
        </SettingsRow>
        <SettingsRow
          v-if="env"
          label="Edit the workflows"
          hint="Opens the build in ComfyUI. Save a version, then deploy it here."
          layout="inline"
        >
          <Button size="sm" @click="hostActions.launch(env)">Open in ComfyUI</Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Scaling"
        description="Workers start on demand. A cold start takes about 40 seconds."
      >
        <SettingsRow label="GPU" layout="inline"
          ><span>{{ dep.gpu }}</span></SettingsRow
        >
        <SettingsRow label="Workers" hint="Min – max" layout="inline"
          ><span class="tabular-nums">{{ dep.workers }}</span></SettingsRow
        >
      </SettingsSection>
    </div>
  </div>
</template>
