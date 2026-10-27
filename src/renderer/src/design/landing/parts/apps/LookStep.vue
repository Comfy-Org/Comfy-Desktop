<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUp, Check, SlidersHorizontal, Sparkles } from 'lucide-vue-next'
import { DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../../ui/Button.vue'
import DialogContent from '../../ui/DialogContent.vue'
import { cn } from '../../ui/cn'
import AppThemeFrame from './AppThemeFrame.vue'
import BrandKitPicker from './BrandKitPicker.vue'
import StyleControls from './StyleControls.vue'
import ThemeMini from './ThemeMini.vue'
import { appsProto, describeLook, finishLook, flow, send } from '../../appFlow'
import { kitById, newTheme, recipe, THEMES, withKit } from '../../appTheme'

/**
 * Step "Look": how the app looks to the people who use it. Four ways to
 * offer the same guardrailed tokens (the Prototype menu's "Customize"):
 *   panel    - a first look, and a full style panel (an inspector)
 *   themes   - curated themes as live cards, then fine-tune a few knobs
 *   brand    - brand kits first (saved in the workspace, or add one)
 *   describe - say it in words; the agent maps it to tokens and shows
 *              the recipe it used
 * In every one, typing in the chat also describes the look - the
 * from-scratch escape hatch, still inside the guardrails.
 */
const { done = false } = defineProps<{ done?: boolean }>()
const d = computed(() => flow.draft!)
const panel = ref(false)
const ask = ref('')

const summary = computed(() =>
  recipe(d.value.theme)
    .filter((r) => r.key !== 'accent' && r.key !== 'runLabel')
    .map((r) => r.value)
    .join(' · ')
)
const THEME_CARDS = computed(() => [
  ...THEMES.map((t) => ({
    id: t.id,
    label: t.label,
    hint: t.hint,
    apply: () =>
      newTheme({
        ...t.theme,
        runLabel: d.value.theme.runLabel,
        presets: d.value.theme.presets
      })
  })),
  {
    id: 'kit-silverside',
    label: 'Silverside',
    hint: 'Your workspace’s brand kit',
    apply: () => withKit(d.value.theme, 'silverside')
  }
])
const preview = (apply: () => typeof d.value.theme) => apply()
function pickTheme(c: { id: string; apply: () => typeof d.value.theme }): void {
  d.value.theme = c.apply()
  d.value.themeId = c.id
}
const IDEAS = [
  'Clean and light, like a magazine',
  'Bold, like a Nike sneaker drop',
  'Soft and friendly, rounded, purple'
]
function describeInPanel(): void {
  if (!ask.value.trim()) return
  describeLook(ask.value)
  ask.value = ''
}
function describe(text: string): void {
  if (!text.trim()) return
  send(text)
  ask.value = ''
}
</script>

<template>
  <div v-if="flow.draft" class="mt-3">
    <!-- After the step: what was picked -->
    <div
      v-if="done"
      class="flex items-center gap-3 rounded-card border border-border-default p-2 pr-4"
    >
      <ThemeMini
        :theme="d.theme"
        :layout="d.layout"
        class="aspect-[16/10] w-28 shrink-0 rounded-control border border-border-default"
      />
      <span class="min-w-0 flex-1 truncate text-ui text-muted-foreground">{{ summary }}</span>
      <Check :size="14" class="text-status-running" />
    </div>

    <!-- 1. Style panel: a first look, then everything in an inspector -->
    <div
      v-else-if="appsProto.look === 'panel'"
      class="overflow-hidden rounded-card border border-border-default"
    >
      <ThemeMini
        :theme="d.theme"
        :layout="d.layout"
        class="aspect-[16/9] border-b border-border-default"
      />
      <div class="flex items-center gap-3 px-4 py-3">
        <span class="min-w-0 flex-1 truncate text-ui text-subtle-foreground">{{ summary }}</span>
        <Button size="sm" @click="panel = true"
          ><SlidersHorizontal :size="12" />Open style panel</Button
        >
        <Button size="sm" variant="primary" @click="finishLook">Looks good</Button>
      </div>
    </div>

    <!-- 2. Themes: curated looks as live cards, then fine-tune -->
    <div v-else-if="appsProto.look === 'themes'" class="flex flex-col gap-5">
      <div class="grid grid-cols-3 gap-2.5">
        <button
          v-for="c in THEME_CARDS"
          :key="c.id"
          type="button"
          :class="
            cn(
              'flex flex-col gap-2 rounded-card border bg-card-background p-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus hover:bg-card-background-hover',
              d.themeId === c.id ? 'border-base-foreground/70' : 'border-border-default'
            )
          "
          @click="pickTheme(c)"
        >
          <ThemeMini
            :theme="preview(c.apply)"
            :layout="d.layout"
            class="aspect-[4/3] rounded-control"
          />
          <span class="px-1 pb-1">
            <span class="flex items-center gap-1.5 text-ui font-medium"
              >{{ c.label }}<Check v-if="d.themeId === c.id" :size="13"
            /></span>
            <span class="block text-ui text-subtle-foreground">{{ c.hint }}</span>
          </span>
        </button>
      </div>
      <div class="rounded-card border border-border-default p-4">
        <p class="mb-4 text-ui font-medium">Fine-tune</p>
        <div class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-6">
          <StyleControls :only="['layout']" />
          <StyleControls :only="['mode', 'accent']" />
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <Button size="sm" @click="panel = true"><SlidersHorizontal :size="12" />More styles</Button>
        <Button size="sm" variant="primary" @click="finishLook">Looks good</Button>
      </div>
    </div>

    <!-- 3. Brand kit first -->
    <div v-else-if="appsProto.look === 'brand'" class="flex flex-col gap-5">
      <BrandKitPicker />
      <div class="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5">
        <ThemeMini
          :theme="d.theme"
          :layout="d.layout"
          class="aspect-[16/11] rounded-card border border-border-default"
        />
        <StyleControls :only="['layout', 'runLabel']" />
      </div>
      <div class="flex justify-end gap-2">
        <Button size="sm" @click="panel = true"><SlidersHorizontal :size="12" />More styles</Button>
        <Button size="sm" variant="primary" @click="finishLook">Looks good</Button>
      </div>
    </div>

    <!-- 4. Describe it: words in, a recipe of tokens out -->
    <div v-else class="flex flex-col gap-4">
      <div v-if="!d.described" class="flex flex-wrap gap-2">
        <button
          v-for="i in IDEAS"
          :key="i"
          type="button"
          class="h-8 rounded-control border border-border-default px-3 text-ui text-muted-foreground outline-none hover:bg-secondary-background hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
          @click="describe(i)"
        >
          {{ i }}
        </button>
      </div>
      <ThemeMini
        :theme="d.theme"
        :layout="d.layout"
        class="aspect-[16/9] rounded-card border border-border-default"
      />
      <div v-if="d.described" class="flex flex-col gap-2">
        <p class="text-ui text-subtle-foreground">
          The recipe · inside Comfy’s styles, so it works on every screen
        </p>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="r in recipe(d.theme)"
            :key="r.key"
            type="button"
            class="inline-flex h-7 items-center gap-1.5 rounded-control border border-border-default px-2.5 text-ui outline-none hover:bg-secondary-background focus-visible:ring-2 focus-visible:ring-border-focus"
            @click="panel = true"
          >
            <span class="text-subtle-foreground">{{ r.label }}</span>
            <span
              v-if="r.key === 'accent'"
              class="size-3 rounded-full ring-1 ring-border-strong"
              :style="{ background: r.value }"
            />
            <span v-else>{{ r.value }}</span>
          </button>
        </div>
      </div>
      <div class="flex items-center justify-between gap-2">
        <span class="flex items-center gap-1.5 text-ui text-subtle-foreground"
          ><Sparkles :size="12" />Say more in the chat below, for example “make the button say
          Go”</span
        >
        <Button size="sm" variant="primary" @click="finishLook">Looks good</Button>
      </div>
    </div>

    <!-- The style panel: the real app beside every knob -->
    <DialogRoot v-model:open="panel">
      <DialogContent
        size="lg"
        :closable="false"
        class="grid h-[86vh] w-[min(1280px,94vw)] grid-cols-[minmax(0,1fr)_340px] p-0"
      >
        <div class="min-h-0 overflow-y-auto bg-app-background">
          <AppThemeFrame
            class="min-h-full"
            :name="d.name"
            :blurb="d.blurb"
            author="Pablo · Silverside"
            :thumb-id="d.thumbId"
            :fields="d.fields"
            :cost="d.cost"
            payer="Paid by you while it is a draft"
            :layout="d.layout"
            :theme="d.theme"
          />
        </div>
        <aside class="flex min-h-0 flex-col border-l border-border-default">
          <div class="flex h-14 shrink-0 items-center justify-between px-5">
            <DialogTitle class="text-heading font-semibold">Style</DialogTitle>
            <span class="text-ui text-subtle-foreground">{{
              kitById(d.theme.kit)?.name ?? 'Comfy'
            }}</span>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6 [scrollbar-width:thin]">
            <StyleControls />
          </div>
          <div class="flex flex-col gap-3 border-t border-border-default p-4">
            <form
              class="flex h-9 items-center gap-2 rounded-control border border-border-default pr-1 pl-3 focus-within:border-border-strong"
              @submit.prevent="describeInPanel"
            >
              <Sparkles :size="12" class="text-subtle-foreground" />
              <input
                v-model="ask"
                placeholder="Or describe it to Comfy Agent"
                class="min-w-0 flex-1 bg-transparent text-ui outline-none placeholder:text-subtle-foreground"
              />
              <Button type="submit" size="icon-xs" variant="ghost" aria-label="Send"
                ><ArrowUp :size="12"
              /></Button>
            </form>
            <Button variant="primary" block @click="panel = false">Done</Button>
          </div>
        </aside>
      </DialogContent>
    </DialogRoot>
  </div>
</template>
