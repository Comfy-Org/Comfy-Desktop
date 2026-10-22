<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { Check, ChevronDown, Combine, X } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../../landing/ui/Button.vue'
import { cardVariants } from '../../landing/ui/card.variants'
import { cn } from '../../landing/ui/cn'
import DropdownMenuContent from '../../landing/ui/DropdownMenuContent.vue'
import { editing, startEdit, stopEdit } from '../inspect/selection'
import type { PlaygroundKey } from '../playground'
import type { ConsolidateGroup } from '../consolidate/rules'
import { shortName, type Token } from '../tokens'
import TargetItem from './TargetItem.vue'
import CopyRef from './CopyRef.vue'
import { kitOf } from '../inspect/registry'
import { componentReference, groupReference } from '../reference'
import { cancelConsolidate, session, startConsolidate } from '../consolidate/session'

/**
 * One gallery section. Clicking an unselected component section selects
 * it (edit mode): the stage specimen (`tweakKey`, with props) or the kit
 * component clicked (`components`). Until then clicks select instead of
 * reaching the component; once selected it works normally. While editing, the whole bento gets
 * the accent ring and an "Editing … · Done" control, and other bentos dim;
 * the component itself is never outlined, so changes stay easy to see.
 *
 * Token sections pass `consolidate` instead: their button starts a
 * consolidation session for that token group (see consolidate/).
 */
const {
  id,
  title,
  description,
  tweakKey,
  components = [],
  tokens = [],
  consolidate
} = defineProps<{
  id: string
  title: string
  description?: string
  tweakKey?: PlaygroundKey
  /** Kit component names in this section that can be tweaked. */
  components?: string[]
  /** Tokens shown in this section (selected one by one in the page). */
  tokens?: Token[]
  /** Token group this section shows; enables "Consolidate". */
  consolidate?: ConsolidateGroup
}>()
provide('gallery-playground', tweakKey)

const consolidating = computed(() => !!consolidate && session.value?.group === consolidate)
const active = computed(() => editing.value?.section === id || consolidating.value)
/** Another section is being edited or consolidated: step back. */
const dimmed = computed(() => !active.value && (!!editing.value || !!session.value))
interface Target {
  component: string | null
  label: string
  token?: Token
}
const targets = computed<Target[]>(() =>
  tweakKey
    ? [{ component: null, label: title }]
    : tokens.length
      ? tokens.map((t) => ({ component: null, label: shortName(t), token: t }))
      : components.map((c) => ({ component: c, label: c }))
)
// Copy reference: the token group, or every kit component rendered here.
const root = ref<HTMLElement>()
function reference(): string {
  if (tokens.length) return groupReference(tokens[0]!.group)
  const names = new Set<string>()
  // Content only: the header's own buttons (Tooltip…) don't count.
  for (const el of root.value?.querySelectorAll(':scope > :not(header) *') ?? []) {
    const kit = kitOf(el)
    if (kit) names.add(kit.name)
  }
  return names.size
    ? [...names].map((n) => componentReference(n)).join('\n\n---\n\n')
    : `# ${title}\n\n${description ?? ''}`
}
/** Component sections can be selected by clicking them (tokens are
 *  selected one by one, in the page). */
const selectable = computed(
  () => !active.value && !session.value && !tokens.length && targets.value.length > 0
)
/** The target under the click: the kit component it lands on, else the
 *  section's first target. */
function targetAt(el: Element): Target {
  for (let n: Element | null = el; n && n !== root.value; n = n.parentElement) {
    const kit = kitOf(n)
    const hit = kit && targets.value.find((t) => t.component === kit.name)
    if (hit) return hit
  }
  return targets.value[0]!
}
function intercept(e: Event): void {
  // Selected, with several components: clicking another one follows it
  // (the click still goes through).
  if (active.value && e.type === 'click' && targets.value.length > 1) {
    const t = targetAt(e.target as Element)
    if (t.component !== editing.value?.component) tweak(t)
    return
  }
  if (!selectable.value) return
  if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  e.stopPropagation()
  if (e.type === 'click' || e instanceof KeyboardEvent) tweak(targetAt(e.target as Element))
}
function tweak(t: Target): void {
  cancelConsolidate()
  startEdit({ section: id, component: t.component, label: t.label, token: t.token?.name })
}
</script>

<template>
  <!-- Each section is its own bento: the kit's elevated card. -->
  <section
    :id
    ref="root"
    :class="
      cn(
        cardVariants({ padding: 'lg' }),
        'flex scroll-mt-6 flex-col gap-6 transition-[opacity,box-shadow] duration-200',
        active && 'ring-2 ring-(--gallery-accent)',
        dimmed && 'opacity-40 hover:opacity-100',
        selectable && 'cursor-pointer hover:ring-1 hover:ring-border-strong [&_*]:cursor-pointer!'
      )
    "
  >
    <header class="flex items-start gap-4">
      <div class="min-w-0 flex-1">
        <h2 class="flex items-center gap-1 text-heading font-semibold">
          {{ title }}
          <CopyRef :what="title" :text="reference" />
        </h2>
        <p v-if="description" class="mt-1 max-w-xl text-ui text-muted-foreground">
          {{ description }}
        </p>
      </div>

      <div v-if="consolidating" class="flex items-center gap-2">
        <span
          class="flex h-7 items-center gap-2 rounded-full bg-(--gallery-accent)/15 px-3 text-ui"
        >
          <span class="size-1.5 rounded-full bg-(--gallery-accent)" />Consolidating
          <span class="text-ui text-muted-foreground">· click tokens to merge by hand</span>
        </span>
        <Button variant="ghost" size="sm" @click="cancelConsolidate"><X :size="13" />Cancel</Button>
      </div>

      <div v-else-if="active" class="flex items-center gap-2">
        <!-- Several targets: the pill switches between them. -->
        <DropdownMenuRoot v-if="targets.length > 1" :modal="false">
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="flex h-7 items-center gap-2 rounded-full bg-(--gallery-accent)/15 px-3 text-ui outline-none hover:bg-(--gallery-accent)/25 focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              <span class="size-1.5 rounded-full bg-(--gallery-accent)" />Editing {{ editing!.label
              }}<ChevronDown :size="12" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-52">
            <TargetItem v-for="t in targets" :key="t.label" :target="t" @select="tweak(t)" />
          </DropdownMenuContent>
        </DropdownMenuRoot>
        <span
          v-else
          class="flex h-7 items-center gap-2 rounded-full bg-(--gallery-accent)/15 px-3 text-ui"
        >
          <span class="size-1.5 rounded-full bg-(--gallery-accent)" />Editing
          {{ editing!.label }}
        </span>
        <Button size="sm" @click="stopEdit"><Check :size="13" />Done</Button>
      </div>

      <div v-else class="flex items-center gap-1">
        <Button v-if="consolidate" variant="ghost" size="sm" @click="startConsolidate(consolidate)"
          ><Combine :size="13" />Consolidate</Button
        >
      </div>
    </header>
    <!-- Unselected: a click selects the component instead of using it.
         Selected: everything inside works normally. -->
    <div
      class="flex flex-col gap-6"
      @pointerdown.capture="intercept"
      @mousedown.capture="intercept"
      @click.capture="intercept"
      @keydown.capture="intercept"
    >
      <slot />
    </div>
  </section>
</template>
