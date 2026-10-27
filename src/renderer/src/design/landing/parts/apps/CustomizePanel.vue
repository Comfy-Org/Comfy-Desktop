<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUp, Check } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import { cn } from '../../ui/cn'
import BrandKitPicker from './BrandKitPicker.vue'
import StyleControls from './StyleControls.vue'
import ThemeMini from './ThemeMini.vue'
import { appsProto, describeLook, finishLook, flow } from '../../appFlow'
import { newTheme, recipe, THEMES, withKit, type AppTheme } from '../../appTheme'

/**
 * Customize the look, in the left column (the app stays on the right and
 * updates as you go). Four ways to offer the same guardrailed styles - the
 * Prototype menu's "Customize": the full style panel, curated themes,
 * brand kits first, or describing it. Words always work too.
 */
const d = computed(() => flow.draft!)
const ask = ref('')
function describe(text = ask.value): void {
  if (!text.trim()) return
  describeLook(text)
  ask.value = ''
}

const CARDS = computed(() => [
  ...THEMES.map((t) => ({
    id: t.id,
    label: t.label,
    theme: (): AppTheme =>
      newTheme({ ...t.theme, runLabel: d.value.theme.runLabel, presets: d.value.theme.presets })
  })),
  {
    id: 'kit-silverside',
    label: 'Silverside',
    theme: (): AppTheme => withKit(d.value.theme, 'silverside')
  }
])
function pickTheme(c: { id: string; theme: () => AppTheme }): void {
  d.value.theme = c.theme()
  d.value.themeId = c.id
}
const IDEAS = [
  'Clean and light, like a magazine',
  'Bold, like a Nike sneaker drop',
  'Soft and friendly, rounded, purple'
]
const TITLE = {
  panel: 'Style',
  themes: 'Themes',
  brand: 'Brand kit',
  describe: 'Describe it'
}
</script>

<template>
  <div v-if="flow.draft" class="flex min-h-0 flex-1 flex-col">
    <header class="flex h-14 shrink-0 items-center justify-between px-5">
      <span class="text-ui font-semibold">{{ TITLE[appsProto.look] }}</span>
      <span class="text-ui text-subtle-foreground">Changes show on the right</span>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6 [scrollbar-width:thin]">
      <!-- 1. Everything -->
      <StyleControls v-if="appsProto.look === 'panel'" />

      <!-- 2. Curated themes, then fine-tune -->
      <div v-else-if="appsProto.look === 'themes'" class="flex flex-col gap-8">
        <div class="grid grid-cols-2 gap-x-3 gap-y-4">
          <button
            v-for="c in CARDS"
            :key="c.id"
            type="button"
            class="flex flex-col gap-1.5 text-left outline-none"
            @click="pickTheme(c)"
          >
            <ThemeMini
              :theme="c.theme()"
              :layout="d.layout"
              :class="
                cn(
                  'aspect-[4/3] rounded-control border',
                  d.themeId === c.id ? 'border-base-foreground/70' : 'border-border-default'
                )
              "
            />
            <span class="flex items-center gap-1.5 text-ui"
              >{{ c.label }}<Check v-if="d.themeId === c.id" :size="12"
            /></span>
          </button>
        </div>
        <div>
          <SectionHeader title="Fine-tune" />
          <StyleControls :only="['mode', 'accent']" />
        </div>
      </div>

      <!-- 3. Brand kits first -->
      <div v-else-if="appsProto.look === 'brand'" class="flex flex-col gap-8">
        <BrandKitPicker />
        <StyleControls :only="['runLabel', 'header']" />
      </div>

      <!-- 4. Words in, styles out -->
      <div v-else class="flex flex-col gap-6">
        <form
          class="flex flex-col gap-2 rounded-control border border-border-default p-3 focus-within:border-border-strong"
          @submit.prevent="describe()"
        >
          <textarea
            v-model="ask"
            rows="3"
            placeholder="Describe the look, for example: bold and dark, orange button that says Go"
            class="resize-none bg-transparent text-ui outline-none placeholder:text-subtle-foreground"
            @keydown.enter.exact.prevent="describe()"
          />
          <Button type="submit" size="sm" class="self-end"><ArrowUp :size="12" />Apply</Button>
        </form>
        <div class="flex flex-col gap-1.5">
          <button
            v-for="i in IDEAS"
            :key="i"
            type="button"
            class="h-8 rounded-control px-2 text-left text-ui text-muted-foreground outline-none hover:bg-secondary-background hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
            @click="describe(i)"
          >
            {{ i }}
          </button>
        </div>
        <div>
          <SectionHeader title="What it uses" />
          <div
            v-for="r in recipe(d.theme)"
            :key="r.key"
            class="flex h-9 items-center justify-between border-t border-border-default text-ui"
          >
            <span class="text-subtle-foreground">{{ r.label }}</span>
            <span
              v-if="r.key === 'accent'"
              class="size-3.5 rounded-full ring-1 ring-border-strong"
              :style="{ background: r.value }"
            />
            <span v-else>{{ r.value }}</span>
          </div>
        </div>
      </div>
    </div>

    <footer class="flex shrink-0 flex-col gap-3 border-t border-border-default p-4">
      <form
        v-if="appsProto.look !== 'describe'"
        class="flex h-9 items-center gap-2 rounded-control border border-border-default pr-1 pl-3 focus-within:border-border-strong"
        @submit.prevent="describe()"
      >
        <input
          v-model="ask"
          placeholder="Or describe it to Comfy Agent"
          class="min-w-0 flex-1 bg-transparent text-ui outline-none placeholder:text-subtle-foreground"
        />
        <Button type="submit" size="icon-xs" variant="ghost" aria-label="Apply"
          ><ArrowUp :size="12"
        /></Button>
      </form>
      <Button variant="primary" block @click="finishLook()">Done</Button>
    </footer>
  </div>
</template>
