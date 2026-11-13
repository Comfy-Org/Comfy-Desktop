<script setup lang="ts">
import { ref } from 'vue'
import { Check, Copy, ExternalLink } from 'lucide-vue-next'
import { toast } from '../../useProto'

/** A web address in a meta line: quiet text that opens it, with small
 *  copy and open buttons beside it. `pending` for one that isn't live yet. */
const { address, pending = false } = defineProps<{ address: string; pending?: boolean }>()
const copied = ref(false)
function copy(): void {
  void navigator.clipboard?.writeText(`https://${address}`).catch(() => {})
  copied.value = true
  setTimeout(() => (copied.value = false), 1400)
}
const open = (): void => toast(`Opening ${address}`)
</script>

<template>
  <span class="mar-addr" :class="pending && 'is-pending'">
    <button
      type="button"
      class="mar-addr-text"
      :disabled="pending"
      :title="pending ? 'Goes live with the space' : `Open ${address}`"
      @click="open"
    >
      {{ address }}
    </button>
    <button
      type="button"
      class="mar-addr-ic"
      :aria-label="copied ? 'Copied' : 'Copy address'"
      @click="copy"
    >
      <Check v-if="copied" :size="13" /><Copy v-else :size="13" />
    </button>
    <button
      v-if="!pending"
      type="button"
      class="mar-addr-ic"
      aria-label="Open in browser"
      @click="open"
    >
      <ExternalLink :size="13" />
    </button>
  </span>
</template>

<style>
.mar-addr {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}
:root .proto-ui.proto-ui.proto-ui .mar-addr-text {
  height: 26px;
  margin-left: -6px;
  padding: 0 6px;
  border-radius: var(--radius-control);
  color: var(--color-base-foreground);
  font-size: 13px;
  text-decoration: underline;
  text-decoration-color: color-mix(in oklch, var(--color-base-foreground) 25%, transparent);
  text-underline-offset: 3px;
}
:root .proto-ui.proto-ui.proto-ui .mar-addr-text:hover {
  text-decoration-color: currentColor;
}
:root .proto-ui.proto-ui.proto-ui .mar-addr.is-pending .mar-addr-text {
  color: var(--color-muted-foreground);
  text-decoration: none;
}
:root .proto-ui.proto-ui.proto-ui .mar-addr-ic {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--radius-control);
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-addr-ic:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
</style>
