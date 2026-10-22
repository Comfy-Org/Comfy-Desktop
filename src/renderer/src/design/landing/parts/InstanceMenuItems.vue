<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDownToLine, Check, Plus } from 'lucide-vue-next'
import Badge from '../ui/Badge.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../ui/DropdownMenuSeparator.vue'
import InstanceGlyph from './InstanceGlyph.vue'
import { activeInstance, hostActions, instances, proto, requireLogin } from '../useProto'
import type { ProtoInstance } from '../mock'
import { shownCredits } from '../account'

/**
 * Items for any "pick an instance" menu: the Launch ComfyUI button and the
 * agent input's Run on picker. Locals first (running, then recent), then
 * Comfy Cloud and deployments. Logged out, Cloud becomes a Log in action.
 * Create new environment always closes the list.
 */
const { mode, label } = defineProps<{ mode: 'launch' | 'select'; label: string }>()
const emit = defineEmits<{ choose: [inst: ProtoInstance] }>()

const local = computed(() =>
  instances.value
    .filter((i) => i.kind === 'local')
    .sort(
      (a, b) =>
        Number(b.state === 'running') - Number(a.state === 'running') ||
        a.lastUsedRank - b.lastUsedRank
    )
)
const cloud = computed(() => instances.value.filter((i) => i.kind === 'cloud'))

function sub(i: ProtoInstance): string {
  if (i.deployment) return `Cloud build · ${i.gpu}${i.state === 'running' ? ' · running' : ''}`
  if (i.kind === 'cloud')
    return proto.signedIn
      ? shownCredits.value
        ? `Cloud GPUs · ${shownCredits.value} credits`
        : 'Cloud GPUs'
      : 'Log in to start · free credits'
  if (i.state === 'running') return 'Running · localhost:8188'
  if (i.state === 'update') return `${i.channel} · ${i.version} · update available`
  return `${i.channel} · ${i.version} · ${i.lastUsed.toLowerCase()}`
}
function choose(i: ProtoInstance): void {
  if (i.kind === 'cloud' && !proto.signedIn) requireLogin()
  else emit('choose', i)
}
</script>

<template>
  <DropdownMenuLabel>{{ label }}</DropdownMenuLabel>
  <DropdownMenuItem v-for="i in local" :key="i.id" class="group min-h-11" @select="choose(i)">
    <InstanceGlyph :inst="i" dot class="[--glyph-ring:var(--color-card-background)]" />
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="font-medium">{{ i.name }}</span>
      <span class="truncate text-ui text-subtle-foreground">{{ sub(i) }}</span>
    </span>
    <ArrowDownToLine v-if="i.state === 'update'" :size="13" />
    <Check v-if="mode === 'select' && i.id === activeInstance.id" :size="14" />
    <span
      v-else-if="mode === 'launch'"
      class="text-ui text-subtle-foreground opacity-0 group-data-highlighted:opacity-100"
    >
      {{ i.state === 'running' ? 'Open' : 'Launch' }}
    </span>
  </DropdownMenuItem>
  <p v-if="!local.length" class="px-2.5 pt-0.5 pb-1.5 text-ui text-subtle-foreground">
    No builds on this computer yet.
  </p>

  <template v-if="cloud.length">
    <DropdownMenuSeparator />
    <DropdownMenuItem v-for="i in cloud" :key="i.id" class="group min-h-11" @select="choose(i)">
      <InstanceGlyph :inst="i" dot class="[--glyph-ring:var(--color-card-background)]" />
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="font-medium">{{ i.name }}</span>
        <span class="truncate text-ui text-subtle-foreground">{{ sub(i) }}</span>
      </span>
      <Badge v-if="!proto.signedIn" variant="solid" size="md">Log in</Badge>
      <Check v-else-if="mode === 'select' && i.id === activeInstance.id" :size="14" />
      <span
        v-else-if="mode === 'launch'"
        class="text-ui text-subtle-foreground opacity-0 group-data-highlighted:opacity-100"
      >
        {{ i.state === 'running' || !i.deployment ? 'Open' : 'Launch' }}
      </span>
    </DropdownMenuItem>
  </template>

  <DropdownMenuSeparator />
  <DropdownMenuItem @select="hostActions.newInstance()"
    ><Plus :size="15" />Create new build</DropdownMenuItem
  >
</template>
