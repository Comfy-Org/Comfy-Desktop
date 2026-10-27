<script setup lang="ts">
import { computed } from 'vue'
import { Check } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import { cn } from '../../ui/cn'
import BrandKitPicker from './BrandKitPicker.vue'
import StyleControls from './StyleControls.vue'
import ThemeMini from './ThemeMini.vue'
import { appsProto, finishLook, flow, send } from '../../appFlow'
import { newTheme, recipe, THEMES, withKit, type AppTheme } from '../../appTheme'

/**
 * The look, as a card in the chat (the app on the right updates as you
 * go). Four ways to offer the same guardrailed styles - the Prototype
 * menu's "Customize": every style, curated themes, brand kits first, or
 * describing it. It stays editable after the first pass; typing in the
 * chat works too.
 */
const d = computed(() => flow.draft!)
function describe(text: string): void {
  send(text)
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
</script>

<template>
  <div v-if="flow.draft" class="mt-3 flex flex-col gap-4">
    <div>
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
        <p class="text-ui text-subtle-foreground">
          Type the look in the chat below, or start from one of these.
        </p>
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

    <div v-if="flow.stage === 'look'" class="flex justify-end gap-2">
      <Button size="sm" variant="ghost" :disabled="flow.busy" @click="finishLook(true)"
        >Skip</Button
      >
      <Button size="sm" variant="primary" :disabled="flow.busy" @click="finishLook()"
        >Continue</Button
      >
    </div>
  </div>
</template>
