<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronDown, Folder, Search } from 'lucide-vue-next'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { cn } from '../../ui/cn'
import { fieldVariants } from '../../ui/field.variants'
import { floatingSurface, menuItem } from '../../ui/menu.styles'
import { PORTAL_TO } from '../../ui/portal'

/** Where you are, on Desktop's Assets page (UI Playground › Folder
 *  picker › Its own pill): the folder the wall is showing, beside the
 *  build it is read from. All files is every file the build made,
 *  whatever folder it was saved in; a folder holds what is under it,
 *  the folders inside it included, so the count never lies.
 *
 *  The list is the tree, indented as ComfyUI's sidebar draws it, and it
 *  opens on its search, like the Filters menu, so a deep tree is
 *  reached by typing. A search breaks the tree apart, so each row then
 *  says underneath where it sits. */
const model = defineModel<string>({ required: true })
const { folders } = defineProps<{
  folders: { id: string; name: string; above: string; depth: number; count: number }[]
}>()
const open = ref(false)
const q = ref('')
const searching = computed(() => !!q.value.trim())
const match = (s: string): boolean => s.toLowerCase().includes(q.value.trim().toLowerCase())
const ALL = 'All files'
const found = computed(() => folders.filter((f) => match(`${f.above} / ${f.name}`)))
const allShown = computed(() => match(ALL))
const here = computed(() => folders.find((f) => f.id === model.value))
// The indent stops growing at the fourth level, so a deep name keeps
// its room (MarAssetsPage's sidebar does the same).
const indent = (depth: number): string => `${Math.min(depth, 4) * 12}px`
function pick(id: string): void {
  model.value = id
  open.value = false
}
</script>

<template>
  <PopoverRoot v-model:open="open" @update:open="(o) => !o && (q = '')">
    <PopoverTrigger as-child>
      <button
        type="button"
        :class="
          cn(
            fieldVariants({}),
            'mar-asset-folder w-auto max-w-60 min-w-0 cursor-pointer gap-2 pr-2 outline-none focus-visible:border-border-focus data-[state=open]:border-border-strong'
          )
        "
        aria-label="Folder"
        :title="here ? [here.above, here.name].filter(Boolean).join(' / ') : ALL"
      >
        <Folder :size="14" class="shrink-0 text-subtle-foreground" />
        <span class="min-w-0 truncate">{{ here?.name ?? ALL }}</span>
        <ChevronDown :size="13" class="ml-auto shrink-0 text-subtle-foreground" />
      </button>
    </PopoverTrigger>
    <PopoverPortal :to="PORTAL_TO">
      <PopoverContent
        align="start"
        :side-offset="6"
        :class="cn(floatingSurface, 'flex max-h-80 w-72 flex-col overflow-y-auto')"
      >
        <label class="afm-search">
          <Search :size="14" />
          <input v-model="q" placeholder="Find a folder..." aria-label="Find a folder" />
        </label>
        <div class="afm-sep" />
        <div class="flex flex-col gap-0.5" role="listbox" aria-label="Folders">
          <button
            v-if="allShown"
            type="button"
            role="option"
            :aria-selected="model === ''"
            :class="
              cn(menuItem, 'w-full gap-3 text-left', model === '' && 'bg-secondary-background')
            "
            @click="pick('')"
          >
            <span class="min-w-0 flex-1 truncate">{{ ALL }}</span>
            <Check v-if="model === ''" :size="14" class="shrink-0 text-base-foreground" />
          </button>
          <button
            v-for="f in found"
            :key="f.id"
            type="button"
            role="option"
            :aria-selected="f.id === model"
            :class="
              cn(
                menuItem,
                'w-full items-center gap-3 text-left',
                f.id === model && 'bg-secondary-background'
              )
            "
            :style="searching ? undefined : { paddingLeft: `calc(10px + ${indent(f.depth)})` }"
            @click="pick(f.id)"
          >
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="min-w-0 truncate">{{ f.name }}</span>
              <span
                v-if="searching && f.above"
                class="min-w-0 truncate text-[11px] text-subtle-foreground"
                >{{ f.above }}</span
              >
            </span>
            <span class="shrink-0 text-subtle-foreground tabular-nums">{{ f.count }}</span>
            <Check v-if="f.id === model" :size="14" class="shrink-0 text-base-foreground" />
          </button>
          <p v-if="!allShown && !found.length" class="afm-none">No matching folders</p>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
