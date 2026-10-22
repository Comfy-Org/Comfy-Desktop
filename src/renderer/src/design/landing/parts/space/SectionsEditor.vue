<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDown, ArrowUp, Pin, Plus, Trash2 } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Switch from '../../ui/Switch.vue'
import Card from '../../ui/Card.vue'
import Checkbox from '../../ui/Checkbox.vue'
import Input from '../../ui/Input.vue'
import { SPACE_BUILTINS, spaceById, type SpaceSection } from '../../spaces'
import { toast } from '../../useProto'

/** Show, hide and order a space's home sections; add a section of
 *  hand-picked tools. */
const { spaceId } = defineProps<{ spaceId: string }>()
const space = computed(() => spaceById(spaceId)!)
// Hints read from the space's real data (published tools, outputs, …).
const visibleTools = computed(() => space.value.catalog.filter((c) => c.visible))
function hint(s: SpaceSection): string {
  const sp = space.value
  if (s.pin) {
    const items = s.pin.map((id) => sp.catalog.find((c) => c.id === id))
    const names = items.filter((c) => c?.visible).map((c) => c!.name)
    const off = items.length - names.length
    return [names.join(', ') || 'No visible tools', off && `${off} hidden or removed`]
      .filter(Boolean)
      .join(' · ')
  }
  switch (s.builtin) {
    case 'tools':
      return visibleTools.value.length
        ? `${visibleTools.value.length} of ${sp.catalog.length} published tools`
        : 'No published tools yet'
    case 'recent':
      return sp.library.length
        ? `${sp.library.length} recent runs`
        : 'Empty until someone runs a tool'
    case 'library':
      return sp.library.length ? `${sp.library.length} outputs` : 'No outputs yet'
    case 'request':
      return `${sp.requests.filter((r) => r.status !== 'shipped').length} open requests`
    case 'usage':
      return `${(sp.budget - sp.used).toLocaleString('en-US')} credits left`
    case 'announcement':
      return sp.brand.announcement || 'Empty - write one in Brand'
    default:
      return SPACE_BUILTINS.find((b) => b.key === s.builtin)?.hint ?? ''
  }
}

function move(i: number, d: -1 | 1): void {
  const list = space.value.sections
  const j = i + d
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j]!, list[i]!]
}
function remove(id: string): void {
  space.value.sections = space.value.sections.filter((s) => s.id !== id)
}

const adding = ref(false)
const title = ref('')
const picked = ref<string[]>([])
function toggle(v: string, on: boolean): void {
  picked.value = on ? [...picked.value, v] : picked.value.filter((x) => x !== v)
}
function add(): void {
  if (!title.value.trim() || !picked.value.length) return
  space.value.sections.splice(1, 0, {
    id: `pin-${Date.now()}`,
    title: title.value.trim(),
    visible: true,
    pin: [...picked.value]
  })
  toast(`Added "${title.value.trim()}"`)
  adding.value = false
  title.value = ''
  picked.value = []
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <Card class="divide-y divide-border-default overflow-hidden">
      <div
        v-for="(s, i) in space.sections"
        :key="s.id"
        class="flex min-h-13 items-center gap-2 py-2 pr-3 pl-1.5"
      >
        <div class="flex flex-col">
          <Button
            variant="ghost"
            size="icon-xs"
            class="h-4"
            :disabled="i === 0"
            aria-label="Move up"
            @click="move(i, -1)"
            ><ArrowUp :size="12"
          /></Button>
          <Button
            variant="ghost"
            size="icon-xs"
            class="h-4"
            :disabled="i === space.sections.length - 1"
            aria-label="Move down"
            @click="move(i, 1)"
            ><ArrowDown :size="12"
          /></Button>
        </div>
        <div class="min-w-0 flex-1">
          <p
            :class="[
              'flex items-center gap-1.5 truncate text-ui font-medium',
              !s.visible && 'text-subtle-foreground'
            ]"
          >
            <Pin v-if="s.pin" :size="12" class="shrink-0" />{{ s.title }}
          </p>
          <p class="truncate text-ui text-subtle-foreground">
            {{ hint(s) }}
          </p>
        </div>
        <Button
          v-if="s.pin"
          variant="ghost"
          size="icon-xs"
          aria-label="Remove section"
          @click="remove(s.id)"
          ><Trash2 :size="12"
        /></Button>
        <Switch v-model="s.visible" :aria-label="`Show ${s.title}`" />
      </div>
    </Card>

    <Button v-if="!adding" variant="secondary" block @click="adding = true"
      ><Plus :size="14" />Add a section of picked tools</Button
    >
    <Card v-else padding="sm" class="flex flex-col gap-3">
      <p class="text-ui font-medium">New section</p>
      <Input v-model="title" placeholder="e.g. Start here" aria-label="Section title" />
      <div class="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
        <label
          v-for="c in visibleTools"
          :key="c.id"
          class="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-control px-1.5 hover:bg-secondary-background"
        >
          <Checkbox
            :model-value="picked.includes(c.id)"
            @update:model-value="(v: boolean) => toggle(c.id, v)"
          />
          <span class="truncate text-ui">{{ c.name }}</span>
        </label>
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="adding = false">Cancel</Button>
        <Button variant="primary" size="sm" :disabled="!title.trim() || !picked.length" @click="add"
          >Add section</Button
        >
      </div>
    </Card>
  </div>
</template>
