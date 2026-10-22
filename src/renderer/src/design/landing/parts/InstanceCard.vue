<script setup lang="ts">
import { computed } from 'vue'
import { Play, SquareArrowOutUpRight } from 'lucide-vue-next'
import Button from '../ui/Button.vue'
import Card from '../ui/Card.vue'
import InstanceActions from './InstanceActions.vue'
import InstanceGlyph from './InstanceGlyph.vue'
import InstanceStatus from './InstanceStatus.vue'
import { go, hostActions, proto, requireLogin } from '../useProto'
import type { ProtoInstance } from '../mock'

const {
  inst,
  detailed = false,
  launchOnClick = false
} = defineProps<{
  inst: ProtoInstance
  detailed?: boolean
  /** Milestone 1 (today's dashboard): the tile launches; later it opens
   *  the build's page and its button launches. */
  launchOnClick?: boolean
}>()

const locked = computed(() => inst.kind === 'cloud' && !proto.signedIn)
const subtitle = computed(() => {
  if (inst.deployment) return `Cloud build · ${inst.version}`
  if (inst.kind === 'cloud')
    return proto.signedIn ? 'Runs on cloud GPUs · no setup' : 'Log in to run on cloud GPUs'
  return [inst.channel, inst.version].filter(Boolean).join(' · ')
})
const meta = computed(() => {
  if (inst.kind === 'local') return [inst.gpu, inst.diskSize, `${inst.models} models`]
  if (inst.deployment)
    return [
      inst.gpu,
      `${inst.nodes} node packs`,
      inst.state === 'running' ? '1 replica' : 'Scaled to zero'
    ]
  return [inst.gpu, 'Pay per run']
})

function activate(): void {
  if (locked.value) requireLogin()
  else hostActions.launch(inst)
}
/** Create / Build IA: the card opens the environment; its button launches. */
function openCard(): void {
  if (launchOnClick) activate()
  else go(`environment:${inst.id}`)
}
</script>

<template>
  <Card
    variant="elevated"
    padding="md"
    interactive
    role="button"
    tabindex="0"
    class="group flex min-w-0 flex-col gap-3.5"
    @click="openCard"
    @keydown.enter="openCard"
  >
    <div class="flex items-start justify-between">
      <InstanceGlyph :inst :size="detailed ? 'lg' : 'md'" />
      <div class="flex items-center gap-1">
        <InstanceStatus :inst />
        <InstanceActions :inst />
      </div>
    </div>
    <div class="min-w-0">
      <p class="truncate text-heading font-semibold">{{ inst.name }}</p>
      <p class="truncate text-ui text-muted-foreground">{{ subtitle }}</p>
      <p
        v-if="detailed"
        class="mt-2.5 flex flex-wrap gap-x-2.5 gap-y-1 text-ui text-subtle-foreground"
      >
        <span v-for="m in meta" :key="m">{{ m }}</span>
      </p>
    </div>
    <div class="mt-auto flex items-center justify-between text-ui text-subtle-foreground">
      <span>{{ inst.lastUsed }}</span>
      <Button v-if="locked" variant="primary" size="sm" @click.stop="hostActions.signIn()"
        >Log in</Button
      >
      <Button
        v-else
        size="sm"
        :class="detailed ? '' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'"
        @click.stop="activate"
      >
        <SquareArrowOutUpRight v-if="inst.state === 'running'" :size="12" />
        <Play v-else :size="12" />
        {{ inst.state === 'running' ? 'Open' : 'Launch' }}
      </Button>
    </div>
  </Card>
</template>
