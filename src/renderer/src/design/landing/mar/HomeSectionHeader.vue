<script setup lang="ts">
import { ChevronRight, Plus } from 'lucide-vue-next'
import Button from '../ui/Button.vue'
import Tooltip from '../ui/Tooltip.vue'

const {
  title,
  linkTip,
  addLabel,
  add = 'never',
  addAnchor
} = defineProps<{
  title: string
  linkTip: string
  addLabel: string
  add?: 'always' | 'narrow' | 'never'
  addAnchor?: string
}>()
const emit = defineEmits<{ open: []; add: [] }>()
</script>

<template>
  <div class="mar-sec hsh">
    <h2>
      <Tooltip :content="linkTip">
        <button type="button" class="hsh-link" @click="emit('open')">
          {{ title }}<ChevronRight :size="13" aria-hidden="true" />
        </button>
      </Tooltip>
    </h2>
    <div v-if="add !== 'never'" class="hsh-add" :class="`is-${add}`">
      <Tooltip :content="addLabel">
        <Button
          variant="ghost"
          size="icon"
          class="bg-transparent text-muted-foreground hover:bg-(--color-secondary-background) hover:text-base-foreground"
          :aria-label="addLabel"
          :data-home-tour="addAnchor"
          @click="emit('add')"
        >
          <Plus :size="16" aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .hsh {
  display: flex;
  height: 24px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
:root .proto-ui.proto-ui.proto-ui .hsh-link {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 4px;
  margin: -4px -8px;
  padding: 0 8px;
  border-radius: 8px;
  color: var(--color-muted-foreground);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  outline: none;
  transition: color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .hsh-link:hover {
  background: transparent;
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .hsh-link > svg {
  transition: translate 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .hsh-link:hover > svg {
  translate: 2px 0;
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .hsh-link:hover > svg {
    translate: none;
  }
}
:root .proto-ui.proto-ui.proto-ui .hsh-link:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.hsh-add {
  flex-shrink: 0;
}
.hsh-add.is-narrow {
  display: none;
}
@container mbr-row (max-width: 56rem) {
  .hsh-add.is-narrow {
    display: block;
  }
}
</style>
