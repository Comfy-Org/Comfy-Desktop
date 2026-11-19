<script setup lang="ts">
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../../ui/Button.vue'
import DialogContent from '../../ui/DialogContent.vue'
import en from '@locales/en.json'
import { cancelInstall, flow } from './setupFlow'

/**
 * Leaving while it installs cancels the install, so it asks first. A small
 * dialog over whatever shows the install (the takeover, the install modal or
 * the Home's card); Escape or a click outside keeps installing.
 */
// It names the install where the footer or the card said "Cancel install";
// from Return to Dashboard it keeps production's words.
const install = (): boolean => flow.takeover || flow.background
</script>

<template>
  <DialogRoot v-model:open="flow.confirmCancel">
    <DialogContent size="sm" class="mss-confirm" :closable="false">
      <div class="px-6 pt-6 pb-5">
        <DialogTitle class="text-heading font-semibold">{{
          install() ? 'Cancel install?' : en.overlay.cancelCurrentTitle
        }}</DialogTitle>
        <DialogDescription class="mt-2 text-ui leading-relaxed text-muted-foreground">
          Unfinished steps are rolled back where possible.
        </DialogDescription>
      </div>
      <div class="mss-confirm-foot">
        <Button variant="ghost" @click="flow.confirmCancel = false">Keep installing</Button>
        <Button variant="destructive" @click="cancelInstall">{{
          install() ? 'Cancel install' : en.overlay.cancelConfirm
        }}</Button>
      </div>
    </DialogContent>
  </DialogRoot>
</template>
