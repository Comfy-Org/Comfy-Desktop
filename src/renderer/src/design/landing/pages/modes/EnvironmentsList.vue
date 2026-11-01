<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import PageHeader from '../../ui/PageHeader.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import StatusDot from '../../ui/StatusDot.vue'
import InstanceGlyph from '../../parts/InstanceGlyph.vue'
import EnvLaunchButton from '../../parts/env/EnvLaunchButton.vue'
import RunsOn from '../../parts/env/RunsOn.vue'
import {
  deploymentsOf,
  envKind,
  envKindLabel,
  envStatus,
  isPublished,
  versionsOf
} from '../../parts/env/env'
import { go, hostActions, instances, proto } from '../../useProto'

/**
 * Environments, framed by the lens.
 *  Create: where my work runs - status, start-up time, where it runs.
 *  Build:  what I release - versions, published, deployments.
 */
const where = ref<'all' | 'local' | 'cloud'>('all')
const list = computed(() =>
  instances.value.filter(
    (i) =>
      where.value === 'all' || (where.value === 'local' ? i.kind === 'local' : i.kind === 'cloud')
  )
)
const COLS = 'grid-cols-[minmax(0,1.4fr)_120px_minmax(0,1.2fr)_minmax(0,1fr)_110px_100px]'
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader
      title="Builds"
      :description="
        proto.mode === 'build'
          ? 'A ComfyUI version, custom nodes and models. Save versions, then deploy them.'
          : 'Where your work runs. Each has its own ComfyUI version, custom nodes and models.'
      "
    >
      <template #actions>
        <Button variant="primary" size="lg" @click="hostActions.newInstance()"
          ><Plus :size="15" />New build</Button
        >
      </template>
    </PageHeader>

    <SegmentedControl
      v-model="where"
      variant="contained"
      class="mb-4"
      :options="[
        { value: 'all', label: 'All', count: instances.length },
        {
          value: 'local',
          label: 'This computer',
          count: instances.filter((i) => i.kind === 'local').length
        },
        {
          value: 'cloud',
          label: 'Cloud',
          count: instances.filter((i) => i.kind === 'cloud').length
        }
      ]"
    />

    <!-- Create lens: cards -->
    <div
      v-if="proto.mode !== 'build'"
      class="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3.5"
    >
      <Card
        v-for="e in list"
        :key="e.id"
        padding="md"
        interactive
        role="button"
        tabindex="0"
        class="flex flex-col gap-3.5"
        @click="go(`environment:${e.id}`)"
        @keydown.enter="go(`environment:${e.id}`)"
      >
        <div class="flex items-start justify-between gap-3">
          <InstanceGlyph :inst="e" size="lg" />
          <Badge v-if="envKind(e) === 'managed'" variant="outline" size="md">Managed</Badge>
        </div>
        <div class="min-w-0">
          <p class="truncate text-heading font-semibold">{{ e.name }}</p>
          <p class="mt-0.5 flex items-center gap-1.5 text-ui text-muted-foreground">
            <StatusDot :status="envStatus(e).live ? 'running' : 'idle'" />{{ envStatus(e).label }}
            <span class="text-subtle-foreground">· {{ envStatus(e).start }}</span>
          </p>
        </div>
        <RunsOn :env="e" />
        <div
          class="mt-auto flex items-center justify-between border-t border-border-default pt-3 text-ui text-subtle-foreground"
        >
          <span>{{
            envKind(e) === 'managed'
              ? 'Every model'
              : `${e.models ?? 0} models · ${e.nodes ?? 0} nodes`
          }}</span>
          <EnvLaunchButton :env="e" size="sm" @click.stop />
        </div>
      </Card>
    </div>

    <!-- Build lens: table -->
    <Card v-else class="overflow-hidden">
      <div
        :class="[
          'grid h-10 items-center gap-4 border-b border-border-default bg-secondary-background/40 px-4 text-ui font-medium tracking-wider text-subtle-foreground uppercase',
          COLS
        ]"
      >
        <span>Build</span><span>Latest version</span><span>Runs on</span><span>Contents</span
        ><span>Deployments</span><span class="text-right">Edited</span>
      </div>
      <div
        v-for="e in list"
        :key="e.id"
        role="button"
        tabindex="0"
        :class="[
          'grid min-h-15 cursor-pointer items-center gap-4 border-b border-border-default px-4 outline-none last:border-b-0 hover:bg-secondary-background/50 focus-visible:bg-secondary-background',
          COLS
        ]"
        @click="go(`environment:${e.id}`)"
        @keydown.enter="go(`environment:${e.id}`)"
      >
        <span class="flex min-w-0 items-center gap-3">
          <InstanceGlyph :inst="e" size="sm" />
          <span class="min-w-0"
            ><span class="block truncate font-medium">{{ e.name }}</span
            ><span class="block truncate text-ui text-subtle-foreground">{{
              envKindLabel(e)
            }}</span></span
          >
        </span>
        <span class="flex items-center gap-1.5 text-ui">
          <template v-if="versionsOf(e)[0]">
            {{ versionsOf(e)[0]!.label }}
            <Badge v-if="!versionsOf(e)[0]!.published" size="sm">Local only</Badge>
          </template>
          <span v-else class="text-subtle-foreground">Latest · managed</span>
        </span>
        <span class="truncate text-ui text-muted-foreground">{{
          isPublished(e)
            ? envKind(e) === 'local'
              ? 'This computer + cloud'
              : 'Cloud'
            : 'This computer'
        }}</span>
        <span class="truncate text-ui text-muted-foreground">{{
          envKind(e) === 'managed' ? 'Everything' : `${e.models} models · ${e.nodes} nodes`
        }}</span>
        <span
          class="text-ui tabular-nums"
          :class="deploymentsOf(e.id).length ? '' : 'text-subtle-foreground'"
          >{{ deploymentsOf(e.id).length || '—' }}</span
        >
        <span class="text-right text-ui text-subtle-foreground">{{
          versionsOf(e)[0]?.when ?? '—'
        }}</span>
      </div>
    </Card>
  </div>
</template>
