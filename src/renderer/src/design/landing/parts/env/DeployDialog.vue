<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowRight, Rocket } from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import DialogContent from '../../ui/DialogContent.vue'
import Input from '../../ui/Input.vue'
import Select from '../../ui/Select.vue'
import InstanceGlyph from '../InstanceGlyph.vue'
import { envById, envKind, isPublished, versionsOf } from './env'
import { goIn, proto, toast } from '../../useProto'

/**
 * Deploy as API: a deployment is a pinned environment version + GPUs + an
 * endpoint. Deploying a local environment publishes its version to the
 * cloud first (linked, not copied).
 */
const open = computed({
  get: () => Boolean(proto.deploying),
  set: (v) => {
    if (!v) proto.deploying = null
  }
})
const env = computed(() => (proto.deploying ? envById(proto.deploying) : undefined))
const versions = computed(() => (env.value ? versionsOf(env.value) : []))
const version = ref('')
const name = ref('')
const gpu = ref('rtx6000')
const stage = ref<'production' | 'staging'>('production')
watch(env, (e) => {
  if (!e) return
  version.value = versions.value[0]?.id ?? 'v1'
  name.value = e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-api'
})
const needsPublish = computed(() => {
  const v = versions.value.find((x) => x.id === version.value)
  return Boolean(
    env.value && envKind(env.value) === 'local' && !(v?.published && isPublished(env.value))
  )
})

function deploy(): void {
  const e = env.value
  open.value = false
  toast(
    needsPublish.value
      ? `Publishing ${e?.name} ${version.value}, then deploying…`
      : `Deploying ${name.value}…`
  )
  goIn('build', 'deployments')
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent v-if="env" size="md" class="p-5">
      <DialogTitle class="flex items-center gap-2 text-heading font-semibold"
        ><Rocket :size="16" />Deploy as API</DialogTitle
      >
      <DialogDescription class="mt-1 text-ui text-muted-foreground">
        Runs a fixed version of this build on dedicated GPUs, behind an endpoint you call from your
        code.
      </DialogDescription>

      <div class="mt-5 flex items-center gap-3">
        <Card variant="inset" class="flex flex-1 items-center gap-2.5 p-3">
          <InstanceGlyph :inst="env" size="sm" />
          <span class="min-w-0">
            <span class="block truncate text-ui font-medium">{{ env.name }}</span>
            <span class="text-ui text-subtle-foreground">Build · {{ version }}</span>
          </span>
        </Card>
        <ArrowRight :size="16" class="shrink-0 text-subtle-foreground" />
        <Card variant="inset" class="flex flex-1 items-center gap-2.5 p-3">
          <Rocket :size="18" class="shrink-0 text-muted-foreground" />
          <span class="min-w-0">
            <span class="block truncate font-mono text-ui">{{ name }}</span>
            <span class="text-ui text-subtle-foreground">Deployment · {{ stage }}</span>
          </span>
        </Card>
      </div>

      <div class="mt-5 grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
        <span class="text-ui text-muted-foreground">Name</span>
        <Input v-model="name" mono aria-label="Deployment name" />
        <span class="text-ui text-muted-foreground">Version</span>
        <Select
          v-model="version"
          :options="versions.map((v) => ({ value: v.id, label: `${v.label} · ${v.note}` }))"
        />
        <span class="text-ui text-muted-foreground">Stage</span>
        <Select
          v-model="stage"
          :options="[
            { value: 'production', label: 'Production' },
            { value: 'staging', label: 'Staging' }
          ]"
        />
        <span class="text-ui text-muted-foreground">GPU</span>
        <Select
          v-model="gpu"
          :options="[
            { value: 'rtx6000', label: 'RTX Pro 6000 · 96 GB' },
            { value: 'h100', label: 'H100 · 80 GB' },
            { value: 'l40s', label: 'L40S · 48 GB' }
          ]"
        />
      </div>
      <p
        v-if="needsPublish"
        class="mt-4 rounded-control bg-secondary-background px-3 py-2 text-ui text-muted-foreground"
      >
        {{ version }} only exists on this computer. It will be published to the cloud first - the
        build stays linked.
      </p>

      <div class="mt-6 flex justify-end gap-2">
        <Button variant="ghost" @click="open = false">Cancel</Button>
        <Button variant="primary" @click="deploy">{{
          needsPublish ? 'Publish and deploy' : 'Deploy'
        }}</Button>
      </div>
    </DialogContent>
  </DialogRoot>
</template>
