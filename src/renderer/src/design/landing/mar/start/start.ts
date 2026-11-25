import { computed } from 'vue'
import { hostActions, proto } from '../../useProto'
import { INSTANCES } from '../../mock'
import { onCloud } from '../shell/surface'

/**
 * What every first-run Home offers besides its own idea: Comfy Cloud,
 * ready now, and this computer. The local action follows the surface: on
 * Cloud it installs the Desktop app, on Desktop it sets up ComfyUI here.
 */
export function openCloud(): void {
  if (proto.signedIn) hostActions.launch(INSTANCES[0]!)
  else hostActions.signIn()
}
export function setUpLocal(): void {
  hostActions.newInstance()
}
export const local = computed(() =>
  onCloud.value
    ? {
        action: 'Install Desktop',
        short: 'Install',
        note: 'Get the Desktop app to run on your own GPU'
      }
    : {
        action: 'Set up this computer',
        short: 'Set up',
        note: 'Run ComfyUI on your own GPU, offline'
      }
)

/** Real ComfyUI outputs (the install showcase's clips). */
export const CLIPS = './install-showcase-scene/Assets'
