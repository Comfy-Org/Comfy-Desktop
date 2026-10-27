<script setup lang="ts">
import { ref } from 'vue'
import PromptBox from '../PromptBox.vue'
import StarterCards, { type Starter } from '../StarterCards.vue'
import { startNew } from '../../appFlow'

/** The Agent's landing: one big prompt, and a hand of apps people could
 *  build. A card hands its idea to the agent. */
const text = ref('')
const APPS: (Starter & { prompt: string })[] = [
  {
    label: 'Product relight',
    thumbId: 'template_product_placement',
    prompt: 'An app that relights product photos in three light setups'
  },
  {
    label: 'Photo to video',
    thumbId: 'video_ltx2_5_i2v',
    prompt: 'An app that turns a photo into a 5 second video'
  },
  {
    label: 'Reshoot a photo',
    thumbId: 'api_google_nano_banana2_image_edit',
    prompt: 'An app that reshoots a photo in a new place'
  },
  {
    label: 'Room stager',
    thumbId: 'image_qwen_image_edit_2511',
    prompt: 'An app that stages an empty room with furniture'
  },
  {
    label: '4K upscaler',
    thumbId: 'utility_seedvr2_image_upscale',
    prompt: 'An app that upscales any render to clean 4K'
  }
]
function pick(s: Starter): void {
  startNew(APPS.find((a) => a.label === s.label)?.prompt ?? s.label)
}
</script>

<template>
  <div class="flex min-h-full flex-col items-center justify-center px-6 pt-16 pb-10">
    <h2 class="text-center text-display font-semibold tracking-[-0.02em]">
      What do you want to make?
    </h2>
    <PromptBox
      v-model="text"
      chat
      class="mt-8 w-full max-w-2xl"
      @send="(t: string) => startNew(t)"
    />
    <p class="mt-16 text-ui text-subtle-foreground">Or start from an app idea</p>
    <StarterCards :items="APPS" :on-select="pick" label="App ideas" class="mt-2" />
  </div>
</template>
