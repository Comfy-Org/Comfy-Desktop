<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronDown, Layers } from 'lucide-vue-next'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import LocationIcon from '../../ui/LocationIcon.vue'
import { cn } from '../../ui/cn'
import { fieldVariants } from '../../ui/field.variants'
import { floatingSurface, menuItem } from '../../ui/menu.styles'
import { PORTAL_TO } from '../../ui/portal'
import { assetBuilds, buildStatus, type AssetBuild } from './assetBuilds'
import { assetsEverywhere } from './assetsEverywhere'

/** Whose assets (Assets, Phase 2): one build at a time, each with its
 *  state, as the PRD scopes it (browsing across builds is its own
 *  scope; UI Playground › Everywhere in Assets adds every running build
 *  at once). Assets remembers the pick. A stopped build
 *  stays on the list; picking it shows a page that offers to start it,
 *  nothing starts on its own. */
const model = defineModel<string>({ required: true })
const open = ref(false)
const current = (): AssetBuild | undefined => assetBuilds.value.find((b) => b.id === model.value)
const STATE = { running: 'Running', launching: 'Starting', stopped: 'Stopped' } as const
// Two lines a row: the name, then where it runs and its state.
const rows = computed(() => [
  ...(assetsEverywhere.id === 'on'
    ? [
        {
          id: 'all',
          name: 'Everywhere',
          cloud: false,
          status: '',
          sub: 'Every running build at once'
        }
      ]
    : []),
  ...assetBuilds.value.map((b) => {
    const status = buildStatus(b)
    return {
      id: b.id,
      name: b.name,
      cloud: b.kind === 'cloud',
      status,
      sub: `${b.kind === 'cloud' ? 'Cloud' : 'Local'} · ${STATE[status]}`
    }
  })
])
function pick(id: string): void {
  model.value = id
  open.value = false
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        :class="
          cn(
            fieldVariants({}),
            'w-auto max-w-64 cursor-pointer gap-2 pr-2 outline-none focus-visible:border-border-focus data-[state=open]:border-border-strong'
          )
        "
        aria-label="Build"
      >
        <Layers v-if="model === 'all'" :size="14" class="shrink-0 text-subtle-foreground" />
        <LocationIcon
          v-else-if="current()"
          :kind="current()!.kind === 'cloud' ? 'cloud' : 'local'"
          :size="14"
          class="shrink-0 text-subtle-foreground"
        />
        <span class="truncate">{{
          model === 'all' ? 'Everywhere' : (current()?.name ?? 'Pick a build')
        }}</span>
        <ChevronDown :size="13" class="ml-auto shrink-0 text-subtle-foreground" />
      </button>
    </PopoverTrigger>
    <PopoverPortal :to="PORTAL_TO">
      <PopoverContent
        align="start"
        :side-offset="6"
        :class="cn(floatingSurface, 'abp flex w-80 flex-col gap-0.5')"
        role="listbox"
        aria-label="Builds"
      >
        <p
          class="px-2.5 pt-2 pb-1.5 text-[11px] font-medium tracking-[0.08em] text-subtle-foreground uppercase"
        >
          Browse the assets of
        </p>
        <button
          v-for="r in rows"
          :key="r.id"
          type="button"
          role="option"
          :aria-selected="r.id === model"
          :class="
            cn(
              menuItem,
              'abp-row h-auto w-full gap-3 py-2 text-left hover:bg-secondary-background',
              r.id === model && 'bg-secondary-background'
            )
          "
          @click="pick(r.id)"
        >
          <span class="abp-tile">
            <Layers v-if="r.id === 'all'" :size="15" />
            <LocationIcon v-else :kind="r.cloud ? 'cloud' : 'local'" :size="15" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="truncate text-base-foreground">{{ r.name }}</span>
            <span class="abp-sub">
              <span v-if="r.status" :class="['abp-dot', `is-${r.status}`]" />{{ r.sub }}
            </span>
          </span>
          <Check v-if="r.id === model" :size="14" class="shrink-0 text-base-foreground" />
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style>
.abp-tile {
  display: inline-flex;
  width: 30px;
  height: 30px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-muted-foreground);
}
.abp-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.abp-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 999px;
  background: var(--color-subtle-foreground);
}
.abp-dot.is-running {
  background: var(--color-success-foreground, oklch(0.75 0.15 150));
}
.abp-dot.is-launching {
  background: var(--color-warning-foreground, oklch(0.8 0.14 80));
}
</style>
