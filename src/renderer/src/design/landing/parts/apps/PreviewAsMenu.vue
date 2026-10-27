<script setup lang="ts">
import { ChevronDown, Eye } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../../ui/Button.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../../ui/DropdownMenuLabel.vue'
import { previewAs, PREVIEWS } from '../../appFlow'

/** "Preview as": open the app's URL as someone else would see it, under
 *  the current share settings (like "Preview as viewer" in Google Docs). */
const { appId, size = 'md' } = defineProps<{ appId: string; size?: 'sm' | 'md' | 'lg' }>()
const emit = defineEmits<{ pick: [] }>()
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" :size><Eye :size="13" />Preview as<ChevronDown :size="12" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-72">
      <DropdownMenuLabel>See what they see</DropdownMenuLabel>
      <DropdownMenuItem
        v-for="p in PREVIEWS"
        :key="p.id"
        @select="
          () => {
            emit('pick')
            previewAs(appId, p.id)
          }
        "
      >
        <span class="min-w-0">
          <span class="block">{{ p.label }}</span>
          <span class="block text-subtle-foreground">{{ p.hint }}</span>
        </span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>
