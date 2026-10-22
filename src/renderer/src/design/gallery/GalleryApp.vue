<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Combine, SlidersHorizontal } from 'lucide-vue-next'
import { TooltipProvider } from 'reka-ui'
import Badge from '../landing/ui/Badge.vue'
import Button from '../landing/ui/Button.vue'
import SegmentedControl from '../landing/ui/SegmentedControl.vue'
import Toaster from '../landing/ui/Toaster.vue'
import GlobalActions from './parts/GlobalActions.vue'
import Inspector from './parts/Inspector.vue'
import Actions from './sections/Actions.vue'
import Display from './sections/Display.vue'
import Foundations from './sections/Foundations.vue'
import Inputs from './sections/Inputs.vue'
import Layout from './sections/Layout.vue'
import Overlays from './sections/Overlays.vue'
import Product from './sections/Product.vue'
import Surfaces from './sections/Surfaces.vue'
import { editing, pickToken, startEdit, stopEdit } from './inspect/selection'
import { attach, changedCount, detach } from './tweaks'
import { GROUPS, shortName } from './tokens'
import { cancelConsolidate, session, sessionLabel, togglePick } from './consolidate/session'

/**
 * Living design gallery for the landing prototype's UI kit (FeedTLDR-style).
 * Tabs: Tokens (foundations), Components (every kit component in its
 * states), Prototype (the real app with the draft applied).
 *
 * Components and tokens are selected by clicking them; until then a click
 * selects instead of using them. Selecting enters edit mode (shown in the
 * top bar, the nav, the section ring and the inspector); the selected
 * component then works normally. Esc or Done leaves it.
 *
 * Token sections also have a Consolidate button: it opens a session
 * (rules, then review) in the inspector; clicking tokens in that section
 * picks them for a merge by hand.
 */
type Tab = 'tokens' | 'components' | 'prototype'
const NAV: Record<'tokens' | 'components', { group: string; items: [string, string][] }[]> = {
  tokens: [
    {
      group: 'Foundations',
      items: [
        ...GROUPS.filter((g) => g.ns.id !== 'spacing').map(
          (g) => [g.ns.id, g.ns.label] as [string, string]
        ),
        ['spacing', 'Spacing'],
        ['grid', 'Grid check']
      ]
    }
  ],
  components: [
    {
      group: 'Components',
      items: [
        ['button', 'Button'],
        ['badge', 'Badge'],
        ['fields', 'Fields'],
        ['segmented', 'Segmented control'],
        ['tabs', 'Tabs'],
        ['toggles', 'Switch and checkbox'],
        ['card', 'Card'],
        ['media-card', 'Media card'],
        ['overlays', 'Menus and overlays'],
        ['avatar', 'Avatar'],
        ['status', 'Status and data'],
        ['empty', 'Empty state'],
        ['headers', 'Headers'],
        ['settings', 'Settings']
      ]
    },
    {
      group: 'In the product',
      items: [
        ['identity', 'Identity marks'],
        ['prompt', 'Prompt box'],
        ['product-cards', 'Product cards'],
        ['illustrations', 'Illustrations']
      ]
    }
  ]
}

const TAB_KEY = 'comfy.design.gallery.tab'
const tab = ref<Tab>((localStorage.getItem(TAB_KEY) as Tab | null) ?? 'components')
watch(tab, (t) => localStorage.setItem(TAB_KEY, t))
// The section being edited or consolidated gets its icon in the nav.
const workingOn = computed(() =>
  session.value
    ? { id: session.value.group, icon: Combine, label: 'Consolidating' }
    : editing.value
      ? { id: editing.value.section, icon: SlidersHorizontal, label: 'Editing' }
      : null
)

// The selected token is marked without drawing on it: an outline would
// sit on the very edges, radius, color or shadow being edited. Instead a
// short accent bar sits in the gap below the sample, and the other samples
// in its section step back (full again on hover, to compare). A rule,
// since the name is only known at runtime.
const selectedToken = computed(() => editing.value?.token ?? null)
const selectedSheet = document.createElement('style')
document.head.appendChild(selectedSheet)
watch(selectedToken, (name) => {
  const group = editing.value?.section
  if (!name || !group) return void (selectedSheet.textContent = '')
  const sel = `[data-token="${CSS.escape(name)}"]`
  const others = `#${CSS.escape(group)} [data-token]:not(${sel})`
  selectedSheet.textContent = [
    `${others} { opacity: 0.55; transition: opacity 150ms; }`,
    `${others}:hover { opacity: 1; }`,
    `${sel} { position: relative; }`,
    `${sel}::after { content: ''; position: absolute; left: 0; bottom: -6px; width: 16px; height: 2px; border-radius: 2px; background: var(--gallery-accent); pointer-events: none; }`
  ].join('\n')
})
onBeforeUnmount(() => selectedSheet.remove())

// ── Scroll spy: the nav marks the section being read ───────
const main = ref<HTMLElement>()
const nav = ref<HTMLElement>()
const active = ref('')
/** Set while a nav click scrolls, so the clicked item stays marked. */
let pinned: string | null = null

function spy(): void {
  const box = main.value
  if (!box || pinned || tab.value === 'prototype') return
  const ids = NAV[tab.value].flatMap((g) => g.items.map(([id]) => id))
  const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 4
  const top = box.getBoundingClientRect().top
  // The last section whose top has passed a line near the top of the view.
  let current = ids[0] ?? ''
  for (const id of ids) {
    const el = document.getElementById(id)
    if (el && el.getBoundingClientRect().top - top <= 96) current = id
  }
  active.value = atEnd ? (ids[ids.length - 1] ?? current) : current
}
let frame = 0
const onScroll = (): void => {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(spy)
}
function jump(id: string): void {
  pinned = id
  active.value = id
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // Release once the smooth scroll settles (scrollend, with a fallback).
  const release = (): void => void (pinned = null)
  main.value?.addEventListener('scrollend', release, { once: true })
  setTimeout(release, 1200)
}
watch(tab, () => nextTick(spy))
// Keep the marked item visible in a long nav.
watch(active, () =>
  nextTick(() => nav.value?.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' }))
)
onMounted(() => nextTick(spy))

// Tokens: an unselected token is selected by clicking it (the click never
// reaches the sample); once selected it works normally (e.g. an animation
// player). While consolidating, clicks pick tokens for a merge by hand.
function onPick(e: Event): void {
  if (tab.value !== 'tokens') return
  const t = pickToken(e.target as Element)
  if (!t) return
  if (!session.value && editing.value?.token === t.name) return
  e.preventDefault()
  e.stopPropagation()
  if (e.type !== 'click') return
  if (session.value) {
    if (t.group === session.value.group) togglePick(t)
  } else startEdit({ section: t.group, component: null, label: shortName(t), token: t.name })
}
function onKey(e: KeyboardEvent): void {
  // Esc closes the topmost thing first: an open menu, select or dialog.
  const layerOpen = document.querySelector(
    '[data-reka-popper-content-wrapper], [role="dialog"][data-state="open"]'
  )
  if (e.key !== 'Escape' || layerOpen || e.defaultPrevented) return
  if (session.value) cancelConsolidate()
  else if (editing.value) stopEdit()
}
// Capture phase: check for open layers before they close themselves.
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))

// Push the draft into the embedded prototype.
let frameDoc: Document | null = null
function onFrameLoad(e: Event): void {
  const doc = (e.target as HTMLIFrameElement).contentDocument
  if (frameDoc) detach(frameDoc)
  frameDoc = doc
  if (doc) attach(doc)
}
onBeforeUnmount(() => frameDoc && detach(frameDoc))
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <!-- --gallery-accent: the one gallery-only color, for selection outlines. -->
    <div
      class="proto-ui flex h-full min-h-0 flex-col bg-card-background [--gallery-accent:oklch(0.733_0.137_262.863)]"
    >
      <header
        class="relative flex h-12 shrink-0 items-center gap-4 border-b border-border-default px-4"
      >
        <h1 class="text-ui font-semibold">Design gallery</h1>
        <SegmentedControl
          v-model="tab"
          variant="contained"
          size="sm"
          class="absolute left-1/2 -translate-x-1/2"
          :options="[
            { value: 'tokens', label: 'Tokens' },
            { value: 'components', label: 'Components' },
            { value: 'prototype', label: 'Prototype' }
          ]"
        />
        <!-- Edit-mode indicator: in the chrome, never over the content. -->
        <div class="ml-auto flex items-center gap-4">
          <span v-if="session" class="flex items-center gap-2 text-ui">
            <span class="size-2 rounded-full bg-(--gallery-accent)" />Consolidating
            <span class="font-medium">{{ sessionLabel }}</span>
            <span class="text-ui text-subtle-foreground">· Esc to cancel</span>
          </span>
          <span v-else-if="editing" class="flex items-center gap-2 text-ui">
            <span class="size-2 rounded-full bg-(--gallery-accent)" />Editing
            <span class="font-medium">{{ editing.label }}</span>
            <span class="text-ui text-subtle-foreground">· Esc to finish</span>
          </span>
          <Badge v-else-if="tab === 'prototype' && changedCount" size="md"
            >Previewing draft · {{ changedCount }}
            {{ changedCount === 1 ? 'change' : 'changes' }}</Badge
          >
          <!-- Global: the whole draft. Per component / token: inspector footer. -->
          <GlobalActions />
        </div>
      </header>

      <div class="flex min-h-0 flex-1">
        <template v-if="tab !== 'prototype'">
          <nav
            ref="nav"
            class="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border-default p-3 [scrollbar-width:thin]"
            aria-label="Sections"
          >
            <div v-for="g in NAV[tab]" :key="g.group" class="flex flex-col">
              <p
                class="px-2 pb-1 text-ui font-medium tracking-wider text-subtle-foreground uppercase"
              >
                {{ g.group }}
              </p>
              <Button
                v-for="[id, label] in g.items"
                :key="id"
                variant="ghost"
                size="sm"
                :class="[
                  'justify-start font-normal',
                  active === id && 'bg-secondary-background text-base-foreground'
                ]"
                :aria-current="active === id ? 'location' : undefined"
                @click="jump(id)"
                >{{ label
                }}<component
                  :is="workingOn.icon"
                  v-if="workingOn?.id === id"
                  :size="13"
                  class="ml-auto text-(--gallery-accent)"
                  :aria-label="workingOn.label"
                  role="img"
              /></Button>
            </div>
          </nav>

          <main
            ref="main"
            :class="[
              'min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]',
              tab === 'tokens' && '[&_[data-token]]:cursor-pointer'
            ]"
            @pointerdown.capture="onPick"
            @click.capture="onPick"
            @scroll.passive="onScroll"
          >
            <div class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-12 pt-12 pb-24">
              <header class="mb-6">
                <h1 class="text-title font-semibold">
                  {{ tab === 'tokens' ? 'Tokens' : 'Components' }}
                </h1>
                <p class="mt-1 text-ui text-muted-foreground">
                  {{
                    tab === 'tokens'
                      ? 'The values everything is built from. Click a token to edit it and see where it is used, or Consolidate a section to reduce them.'
                      : 'Every design-system component in its states. Click one to select it and edit the tokens behind it.'
                  }}
                </p>
              </header>
              <Foundations v-if="tab === 'tokens'" />
              <template v-else>
                <Actions />
                <Inputs />
                <Surfaces />
                <Overlays />
                <Display />
                <Layout />
                <Product />
              </template>
            </div>
          </main>
        </template>

        <iframe
          v-else
          src="/design-landing.html"
          title="Prototype with the current draft"
          class="min-h-0 flex-1 border-0"
          @load="onFrameLoad"
        />

        <Inspector />
      </div>
      <Toaster />
    </div>
  </TooltipProvider>
</template>
