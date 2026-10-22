<script setup lang="ts">
import { Cloud } from 'lucide-vue-next'
import Avatar from '../ui/Avatar.vue'
import Button from '../ui/Button.vue'
import Card from '../ui/Card.vue'
import { hostActions } from '../useProto'
import { thumb } from '../mock'

const { title, body } = defineProps<{ title: string; body: string }>()
const preview = [
  'image_z_image_turbo',
  'video_ltx2_5_i2v',
  'image_qwen_image_edit_2511',
  'template_product_placement',
  'image_flux2',
  'video_wan2_2_14B_i2v'
]
</script>

<template>
  <Card class="relative mt-5 overflow-hidden px-6 py-14 text-center">
    <div
      class="absolute inset-0 grid grid-cols-6 gap-2 p-2 opacity-20 blur-[2px] grayscale [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black_85%)]"
      aria-hidden="true"
    >
      <img
        v-for="id in preview"
        :key="id"
        :src="thumb(id)"
        alt=""
        class="size-full rounded-min object-cover"
      />
    </div>
    <div class="relative flex flex-col items-center gap-2">
      <Avatar size="xl" class="mb-1.5"><Cloud :size="18" /></Avatar>
      <h2 class="text-heading font-semibold">{{ title }}</h2>
      <p class="mb-2.5 max-w-md leading-relaxed text-muted-foreground">{{ body }}</p>
      <Button variant="primary" @click="hostActions.signIn()">Log in</Button>
      <p class="mt-1.5 text-ui text-subtle-foreground">
        New accounts get free Comfy Cloud credits.
      </p>
    </div>
  </Card>
</template>
