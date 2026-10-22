<script setup lang="ts">
import { ArrowLeft, Plus, Undo2 } from 'lucide-vue-next'
import Badge from '../../landing/ui/Badge.vue'
import Button from '../../landing/ui/Button.vue'
import Tooltip from '../../landing/ui/Tooltip.vue'
import { toast } from '../../landing/useProto'
import ConsolidatePanel from './ConsolidatePanel.vue'
import CopyLlm from './CopyLlm.vue'
import DraftChanges from './DraftChanges.vue'
import ElementInspector from './ElementInspector.vue'
import TokenBrowser from './TokenBrowser.vue'
import TokenInspector from './TokenInspector.vue'
import { back, editing, selection } from '../inspect/selection'
import { changedCount, published } from '../tweaks'
import { scopedActions } from '../inspect/actions'
import {
  applyPlan,
  cancelConsolidate,
  changeCount,
  session,
  sessionLabel
} from '../consolidate/session'

/**
 * Right-hand inspector. Context aware: a selected element shows its tokens
 * and values; a selected token shows its value and blast radius; nothing
 * selected shows the draft and every token. The footer holds actions for
 * what is shown (copy and revert it); Publish and Revert all are global and
 * live in the top bar (GlobalActions).
 */
function addPlan(): void {
  const n = applyPlan()
  selection.value = null
  toast(`Added ${n} ${n === 1 ? 'change' : 'changes'} to the draft`)
}
</script>

<template>
  <aside
    class="flex w-88 shrink-0 flex-col border-l border-border-default bg-card-background"
    aria-label="Inspector"
  >
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border-default px-4">
      <Button
        v-if="selection && !session"
        variant="ghost"
        size="icon-xs"
        :aria-label="
          selection.kind === 'token' && editing ? `Back to ${editing.label}` : 'Back to overview'
        "
        @click="back"
        ><ArrowLeft :size="14"
      /></Button>
      <h2 class="flex flex-1 items-center gap-2 text-ui font-semibold">
        <template v-if="session">
          <span class="size-1.5 rounded-full bg-(--gallery-accent)" />Consolidate
          {{ sessionLabel }}
        </template>
        <template v-else-if="editing">
          <span class="size-1.5 rounded-full bg-(--gallery-accent)" />Editing {{ editing.label }}
        </template>
        <template v-else>Inspector</template>
      </h2>
      <Badge v-if="changedCount" size="sm">{{ changedCount }} in draft</Badge>
      <Badge v-if="published.length" variant="outline" size="sm">published</Badge>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:thin]">
      <ConsolidatePanel v-if="session" />
      <TokenInspector
        v-else-if="selection?.kind === 'token'"
        :key="selection.token.name"
        :token="selection.token"
      />
      <ElementInspector v-else-if="selection?.kind === 'element'" :el="selection.el" />
      <template v-else>
        <p class="mb-4 text-ui text-muted-foreground">
          Use Tweak on a component or a token section to edit it. Changes stay in a draft until you
          publish.
        </p>
        <section v-if="changedCount" class="mb-6">
          <h3 class="mb-1 text-ui font-semibold">Draft</h3>
          <DraftChanges />
        </section>
        <h3 class="mb-1 text-ui font-semibold">Tokens</h3>
        <TokenBrowser />
      </template>
    </div>

    <footer v-if="session" class="flex gap-2 border-t border-border-default p-4">
      <Button @click="cancelConsolidate">Cancel</Button>
      <Button variant="primary" class="flex-1" :disabled="!changeCount" @click="addPlan"
        ><Plus :size="13" />Add {{ changeCount }} {{ changeCount === 1 ? 'change' : 'changes' }} to
        draft</Button
      >
    </footer>
    <!-- Scoped to what the inspector shows. Global actions: top bar. -->
    <footer
      v-else-if="scopedActions"
      class="flex flex-col gap-2 border-t border-border-default p-4"
    >
      <p class="truncate text-ui text-subtle-foreground">
        {{
          scopedActions?.changes
            ? `${scopedActions?.changes} ${scopedActions?.changes === 1 ? 'change' : 'changes'} to ${scopedActions?.label}`
            : `No changes to ${scopedActions?.label} yet`
        }}
      </p>
      <div class="flex gap-2 [&>*:first-child]:flex-1">
        <CopyLlm :scope="scopedActions?.scope" :disabled="!scopedActions?.changes" />
        <Tooltip
          wrap
          :content="
            scopedActions?.revert
              ? `Undoes only ${scopedActions?.label}'s changes. Everything else stays in the draft.`
              : `${scopedActions?.label} has no changes of its own to undo.`
          "
        >
          <Button size="sm" :disabled="!scopedActions?.revert" @click="scopedActions?.revert?.()"
            ><Undo2 :size="13" />Revert {{ scopedActions?.label }}</Button
          >
        </Tooltip>
      </div>
    </footer>
    <footer v-else-if="changedCount" class="flex gap-2 border-t border-border-default p-4">
      <CopyLlm label="Copy the whole draft as llm.txt" class="flex-1" />
    </footer>
  </aside>
</template>
