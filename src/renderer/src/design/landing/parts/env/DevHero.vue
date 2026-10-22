<script setup lang="ts">
import { computed, ref } from 'vue'
import { Box, Cloud, X, Zap } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import { go, toast } from '../../useProto'
import { thumb } from '../../mock'

/** "Comfy for developers" (as on platform.comfy.org): three ways to use
 *  Comfy without the UI, each with a code sample. Dismissible. */
const open = ref(true)
type Path = 'router' | 'api' | 'cloud'
const path = ref<Path>('router')
const PATHS: Record<
  Path,
  { title: string; body: string; code: string; cta: string; thumbId: string; model: string }
> = {
  router: {
    title: 'One API key. Every media model.',
    body: 'Integrate image, video, 3D and audio models once. Pick the provider for each job.',
    code: `from comfy_sdk import Comfy

with Comfy() as client:
    result = client.models.run(
        "byteplus/seedream-5-0-pro",
        {"prompt": "a neon coral reef"},
        model_provider="fal",
    )`,
    cta: 'Browse models',
    thumbId: 'image_flux2',
    model: 'Seedream 5.0 Pro'
  },
  api: {
    title: 'Your workflow, as an endpoint.',
    body: 'Deploy any build version on GPUs that scale with traffic. Call it from your code.',
    code: `curl -X POST https://api.comfy.org/v1/product-shots/run \\
  -H "Authorization: Bearer $COMFY_API_KEY" \\
  -d '{"inputs": {"product": "shoe.png"}}'`,
    cta: 'View deployments',
    thumbId: 'template_product_placement',
    model: 'product-shots · v2'
  },
  cloud: {
    title: 'ComfyUI in the cloud, scripted.',
    body: 'Queue workflows on Comfy Cloud from scripts and pipelines. Every model ready, no setup.',
    code: `from comfy_sdk import Comfy

cloud = Comfy(cloud=True)
job = cloud.workflows.queue("hero-shot-v4.json",
    inputs={"seed": 42})
print(job.wait().outputs)`,
    cta: 'Open Comfy Cloud',
    thumbId: 'video_ltx2_5_i2v',
    model: 'hero-shot-v4'
  }
}
const p = computed(() => PATHS[path.value])
function cta(): void {
  if (path.value === 'router') go('router')
  else if (path.value === 'api') go('deployments')
  else toast('Opening Comfy Cloud ↗')
}
</script>

<template>
  <Card
    v-if="open"
    class="relative mb-8 overflow-hidden bg-[radial-gradient(700px_360px_at_15%_0%,rgb(132_132_196/0.10),transparent_70%)] px-10 py-9"
  >
    <Button
      variant="ghost"
      size="icon-sm"
      class="absolute top-4 right-4"
      aria-label="Dismiss"
      @click="open = false"
      ><X :size="15"
    /></Button>
    <div class="flex flex-col items-center text-center">
      <h2 class="text-[28px] font-semibold tracking-[-0.02em]">Comfy for developers</h2>
      <p class="mt-1.5 text-ui text-muted-foreground">
        Use Comfy without the UI. Pick a path to start.
      </p>
      <SegmentedControl
        v-model="path"
        variant="contained"
        class="mt-5"
        :options="[
          { value: 'router', label: 'Comfy Router', icon: Box },
          { value: 'api', label: 'Comfy API', icon: Zap },
          { value: 'cloud', label: 'Comfy Cloud', icon: Cloud }
        ]"
      />
    </div>
    <div class="mt-8 grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-10">
      <div>
        <h3 class="text-[24px] font-semibold tracking-[-0.02em]">{{ p.title }}</h3>
        <p class="mt-2 max-w-md text-ui text-muted-foreground">{{ p.body }}</p>
        <div class="mt-5 flex gap-2">
          <Button variant="primary" @click="go('keys')">Create API key</Button>
          <Button @click="cta">{{ p.cta }}</Button>
          <Button @click="toast('Opening docs.comfy.org ↗')">Open docs</Button>
        </div>
      </div>
      <div class="overflow-hidden rounded-card border border-border-default bg-black/30">
        <pre
          class="overflow-x-auto px-5 py-4 font-mono text-ui leading-relaxed text-base-foreground/90"
        ><code>{{ p.code }}</code></pre>
        <div class="relative h-28 overflow-hidden">
          <img :src="thumb(p.thumbId)" alt="" class="size-full object-cover" />
          <Badge variant="overlay" size="md" class="absolute bottom-2.5 left-2.5">{{
            p.model
          }}</Badge>
        </div>
      </div>
    </div>
  </Card>
</template>
