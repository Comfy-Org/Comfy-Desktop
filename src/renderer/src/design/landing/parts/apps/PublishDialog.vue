<script setup lang="ts">
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import DialogContent from '../../ui/DialogContent.vue'
import PublishPanel from './PublishPanel.vue'
import { dialogs, flow, libApp } from '../../appFlow'

/** The Publish sheet over the chat and split views. */
</script>

<template>
  <DialogRoot v-model:open="dialogs.publish">
    <DialogContent size="lg" class="max-w-[560px] p-6">
      <DialogTitle class="text-heading font-semibold">{{
        libApp(flow.appId) ? 'Live' : 'Publish app'
      }}</DialogTitle>
      <DialogDescription class="mb-5 text-ui text-muted-foreground">
        {{
          libApp(flow.appId)
            ? 'One link. It shows each person what they are allowed to do.'
            : 'Comfy checks every node and model, runs the example once, then makes it live.'
        }}
      </DialogDescription>
      <PublishPanel />
    </DialogContent>
  </DialogRoot>
</template>
