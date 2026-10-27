<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, Image, ListChecks, PanelsTopLeft, Rows3, Type } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Checkbox from '../../ui/Checkbox.vue'
import Input from '../../ui/Input.vue'
import { cn } from '../../ui/cn'
import { hostActions, instanceById, toast } from '../../useProto'
import { flow, type FieldKind } from '../../appFlow'

/**
 * The inputs the agent picked, as a checklist: plain names (editable in
 * place) and where each comes from. A real workflow has dozens of
 * settings, so only the first few show until you expand the list. For
 * full control, App Builder opens the same picks in ComfyUI.
 */
const { editable = true } = defineProps<{ editable?: boolean }>()
const MAX = 6
const fields = computed(() => flow.draft?.fields ?? [])
const expanded = ref(false)
const q = ref('')
const shown = computed(() =>
  expanded.value
    ? fields.value.filter((f) =>
        `${f.label} ${f.node}`.toLowerCase().includes(q.value.toLowerCase())
      )
    : fields.value.slice(0, MAX)
)
const ICON: Record<FieldKind, unknown> = {
  image: Image,
  text: Type,
  choice: ListChecks,
  count: Rows3
}
function openBuilder(): void {
  const name = flow.draft?.source.name ?? 'workflow'
  hostActions.launch(instanceById('local-1')!, `${name} · App Builder`)
  toast('ComfyUI opens in App Builder mode, with these picks')
}
</script>

<template>
  <div>
    <div v-if="expanded" class="border-b border-border-default px-4 py-2.5">
      <Input v-model="q" :placeholder="`Find a setting in ${fields.length}`" size="sm" />
    </div>
    <div
      :class="
        cn(
          'divide-y divide-border-default',
          expanded && 'max-h-96 overflow-y-auto [scrollbar-width:thin]'
        )
      "
    >
      <label
        v-for="f in shown"
        :key="f.id"
        :class="
          cn(
            'flex h-11 items-center gap-3 px-4',
            editable && 'cursor-pointer hover:bg-secondary-background/40'
          )
        "
      >
        <Checkbox v-model="f.on" :disabled="!editable" :aria-label="`Show ${f.label}`" />
        <component
          :is="ICON[f.kind]"
          :size="14"
          :class="cn('shrink-0', f.on ? 'text-muted-foreground' : 'text-subtle-foreground/60')"
        />
        <input
          v-model="f.label"
          :disabled="!editable || !f.on"
          :aria-label="`Label for ${f.node}`"
          :class="
            cn(
              'min-w-0 flex-1 rounded-min bg-transparent px-1 py-0.5 text-ui outline-none hover:bg-secondary-background focus-visible:bg-secondary-background disabled:hover:bg-transparent',
              !f.on && 'text-subtle-foreground'
            )
          "
        />
        <span class="w-28 truncate text-right font-mono text-[12px] text-subtle-foreground">{{
          f.node
        }}</span>
      </label>
      <p v-if="!shown.length" class="px-4 py-6 text-center text-ui text-subtle-foreground">
        No setting matches “{{ q }}”.
      </p>
    </div>

    <div class="flex items-center justify-between gap-3 border-t border-border-default px-4 py-2.5">
      <Button variant="ghost" size="sm" class="-ml-2" @click="expanded = !expanded">
        {{ expanded ? 'Show fewer' : `All ${fields.length} settings` }}
        <ChevronDown :size="13" :class="cn('transition-transform', expanded && 'rotate-180')" />
      </Button>
      <Button variant="ghost" size="sm" class="-mr-2" @click="openBuilder"
        ><PanelsTopLeft :size="12" />Open App Builder</Button
      >
    </div>
  </div>
</template>
