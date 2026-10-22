<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Rocket, RotateCcw } from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../../landing/ui/Button.vue'
import DialogContent from '../../landing/ui/DialogContent.vue'
import Tooltip from '../../landing/ui/Tooltip.vue'
import { toast } from '../../landing/useProto'
import DraftChanges from './DraftChanges.vue'
import {
  changedCount,
  discardDraft,
  publish,
  published,
  refreshStatus,
  restoreOriginal
} from '../tweaks'

/** Global actions for the whole draft, in the top bar: Revert all and
 *  Publish. Per component / token actions live in the inspector footer. */
onMounted(refreshStatus)

const publishing = ref(false)
const reverting = ref(false)
const busy = ref(false)

async function doPublish(): Promise<void> {
  busy.value = true
  try {
    const files = await publish()
    toast(`Published to ${files.join(', ')}`)
    publishing.value = false
    // The dev server reloads the page once the files are written.
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Publish failed')
  } finally {
    busy.value = false
  }
}
async function doRevert(): Promise<void> {
  busy.value = true
  try {
    const restored = published.value.length ? await restoreOriginal() : (discardDraft(), [])
    toast(restored.length ? `Restored ${restored.join(', ')}` : 'Draft discarded')
    reverting.value = false
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Revert failed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- Tooltips sit on wrappers so they still show while a button is disabled. -->
    <Tooltip
      wrap
      side="bottom"
      content="Undoes everything: discards the whole draft and restores every published file to its original. To undo one component or token, use Revert in the inspector."
    >
      <Button
        variant="ghost"
        size="sm"
        :disabled="!changedCount && !published.length"
        @click="reverting = true"
        ><RotateCcw :size="13" />Revert all</Button
      >
    </Tooltip>
    <Tooltip
      wrap
      side="bottom"
      content="Writes the draft into the source files (tokens, component files and every file that uses a merged token). Doesn't commit or push anything to git."
    >
      <Button variant="primary" size="sm" :disabled="!changedCount" @click="publishing = true"
        ><Rocket :size="13" />Publish{{ changedCount ? ` ${changedCount}` : '' }}</Button
      >
    </Tooltip>

    <DialogRoot v-model:open="publishing">
      <DialogContent size="md" class="p-6">
        <DialogTitle class="text-heading font-semibold">Publish to the design system?</DialogTitle>
        <DialogDescription class="mt-1 text-ui text-muted-foreground">
          Writes these changes to the design system in landing/ (tokens.css, component files, and
          every file that uses a merged token). Every screen using them updates, including the
          Electron app. Nothing is committed or pushed: review the diff in git as usual.
        </DialogDescription>
        <div class="mt-4 max-h-72 overflow-y-auto"><DraftChanges /></div>
        <div class="mt-6 flex justify-end gap-2">
          <Button variant="ghost" @click="publishing = false">Keep drafting</Button>
          <Button variant="primary" :disabled="busy" @click="doPublish"
            ><Rocket :size="13" />Publish {{ changedCount }}</Button
          >
        </div>
      </DialogContent>
    </DialogRoot>

    <DialogRoot v-model:open="reverting">
      <DialogContent size="md" class="p-6">
        <DialogTitle class="text-heading font-semibold">Revert everything?</DialogTitle>
        <DialogDescription class="mt-1 text-ui text-muted-foreground">
          Goes back to the very beginning:
        </DialogDescription>
        <ul class="mt-3 flex list-disc flex-col gap-1 pl-5 text-ui">
          <li v-if="changedCount">
            Discards {{ changedCount }} draft {{ changedCount === 1 ? 'change' : 'changes' }}.
          </li>
          <li v-if="published.length">
            Restores {{ published.join(', ') }} to how they were before your first publish.
          </li>
        </ul>
        <div class="mt-6 flex justify-end gap-2">
          <Button variant="ghost" @click="reverting = false">Cancel</Button>
          <Button variant="destructive" :disabled="busy" @click="doRevert"
            >Revert everything</Button
          >
        </div>
      </DialogContent>
    </DialogRoot>
  </div>
</template>
