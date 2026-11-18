<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'
import { Box } from '@lucide/vue'
import {
  Box3,
  NeutralToneMapping,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three'
import type { Object3D } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import Spinner from '@comfyorg/design-system/spinner/Spinner'
import { disposeModel, parseModel, tintUntexturedWhite } from '../lib/modelFile'

const { name, load } = defineProps<{
  name: string
  load: () => Promise<Uint8Array | null>
}>()

const ENVIRONMENT_INTENSITY = 0.8
const FIELD_OF_VIEW = 40
const CAMERA_DIRECTION = new Vector3(0.6, 0.45, 1).normalize()

const { t } = useI18n()
const host = useTemplateRef<HTMLDivElement>('host')
const state = ref<'loading' | 'ready' | 'failed'>('loading')

const scene = new Scene()
scene.environmentIntensity = ENVIRONMENT_INTENSITY
const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.01, 1000)

let renderer: WebGLRenderer | null = null
let controls: OrbitControls | null = null
let frame = 0
let closed = false

function frameModel(model: Object3D): void {
  const bounds = new Box3().setFromObject(model)
  const size = bounds.getSize(new Vector3()).length() || 1
  model.position.sub(bounds.getCenter(new Vector3()))
  const distance = size / (2 * Math.tan((FIELD_OF_VIEW * Math.PI) / 360))
  camera.near = size / 100
  camera.far = size * 100
  camera.position.copy(CAMERA_DIRECTION).multiplyScalar(distance)
  camera.updateProjectionMatrix()
  controls?.target.set(0, 0, 0)
  controls?.update()
}

function draw(): void {
  if (closed || !renderer) return
  controls?.update()
  renderer.render(scene, camera)
  frame = requestAnimationFrame(draw)
}

useResizeObserver(host, ([entry]) => {
  const { width, height } = entry!.contentRect
  if (!renderer || width === 0 || height === 0) return
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
})

onMounted(async () => {
  const frameHost = host.value
  if (!frameHost) return
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.toneMapping = NeutralToneMapping
    const environment = new PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    scene.environment = environment.fromScene(room).texture
    room.dispose()
    environment.dispose()
    renderer.domElement.className =
      'block size-full rounded-lg outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ring)]'
    renderer.domElement.tabIndex = 0
    renderer.domElement.setAttribute('aria-label', t('assets.detail.modelView', { name }))
    renderer.domElement.dataset.testid = 'output-detail-model'
    frameHost.append(renderer.domElement)
    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.listenToKeyEvents(renderer.domElement)
    const bytes = await load()
    const model = bytes && !closed ? await parseModel(bytes, name) : null
    if (closed) {
      if (model) disposeModel(model)
      return
    }
    if (!model) {
      state.value = 'failed'
      return
    }
    tintUntexturedWhite(model)
    scene.add(model)
    frameModel(model)
    state.value = 'ready'
    draw()
  } catch {
    if (!closed) state.value = 'failed'
  }
})

onBeforeUnmount(() => {
  closed = true
  cancelAnimationFrame(frame)
  controls?.dispose()
  disposeModel(scene)
  scene.environment?.dispose()
  renderer?.dispose()
  renderer?.forceContextLoss()
})
</script>

<template>
  <div class="relative size-full min-h-0">
    <div
      ref="host"
      class="size-full"
      :class="state !== 'ready' && 'invisible'"
      :aria-busy="state === 'loading' || undefined"
    />
    <div
      v-if="state === 'loading'"
      class="absolute inset-0 flex items-center justify-center text-subtle-foreground"
      role="status"
      :aria-label="t('assets.detail.modelLoading')"
    >
      <Spinner class="size-6" />
    </div>
    <div
      v-else-if="state === 'failed'"
      class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-subtle-foreground"
      data-testid="output-detail-model-failed"
    >
      <Box :size="40" aria-hidden="true" />
      <span class="text-ui">{{ t('assets.detail.modelFailed') }}</span>
    </div>
  </div>
</template>
